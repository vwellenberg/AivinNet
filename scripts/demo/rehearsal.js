// One day of a season rehearsal (README.md, "Season rehearsal"). Started by rehearsal.sh,
// which has already moved the server's clock; this moves the browser's to the same moment.
//
//   node scripts/demo/rehearsal.js <outdir> <name> <ISO time> [--url URL] [--wait ms]
//        [--after ms] [--dark] [--desk-only] [--phone-only]
//
// Per view it writes <name>-<view>.png (+ -full.png, the whole page), a JSON with the
// browser's clock, the season classes on <html> and the Home headings, and, with --after,
// a second shot that much later (a midnight crossing, a countdown starting).
// <name>-problems.txt collects console errors and warnings, page errors and HTTP >= 400.
// An empty file is the result to aim for.
const { chromium } = require('playwright')
const fs = require('fs')

const [OUT, NAME, TIME, ...rest] = process.argv.slice(2)
if (!TIME) {
    console.error('usage: node scripts/demo/rehearsal.js <outdir> <name> <ISO time> [flags]')
    process.exit(2)
}
const flag = (f) => rest.includes(f)
const opt = (f, d) => {
    const i = rest.indexOf(f)
    return i >= 0 ? rest[i + 1] : d
}
const BASE = opt('--url', 'http://127.0.0.1:19800').replace(/\/$/, '')
const WAIT = Number(opt('--wait', 4000))
const AFTER = Number(opt('--after', 0))

const problems = []

async function view(browser, phone, dark) {
    const tag = `${NAME}-${phone ? 'phone' : 'desk'}${dark ? '-dark' : ''}`
    const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: phone ? 2 : 1,
        isMobile: phone,
        hasTouch: phone,
        // The server runs under faketime in the container's zone; the browser has to agree,
        // or "today" differs between the two near midnight.
        timezoneId: 'UTC',
    })
    const login = await context.request.post(`${BASE}/auth/login`, { data: { username: 'admin', password: 'demo-pass-713' } })
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
    const page = await context.newPage()
    page.on('console', (m) => {
        if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${tag}] console.${m.type()}: ${m.text().slice(0, 300)}`)
    })
    page.on('pageerror', (e) => problems.push(`[${tag}] pageerror: ${String(e).slice(0, 300)}`))
    page.on('response', (r) => {
        // Device sync polls every second; a 4xx there is not this page's.
        if (r.status() >= 400 && !r.url().includes('/devicesync/')) problems.push(`[${tag}] HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
    })
    // install, not setFixedTime: the clock keeps running from here, so animations play and a
    // midnight can be crossed with --after.
    await page.clock.install({ time: new Date(TIME) })
    await page.goto(`${BASE}/#/`, { waitUntil: 'load' }) // never networkidle: device sync polls
    if (dark) {
        await page.waitForTimeout(1500)
        // The app keeps its own light/dark choice; the browser's colour scheme does not reach it.
        await page.locator('.theme-toggle').first().click()
    }
    await page.waitForTimeout(WAIT)
    const { width, height } = page.viewportSize()
    await page.mouse.move(width - 6, Math.round(height * 0.6)) // no hover state in the shot
    const info = await page.evaluate(() => ({
        now: new Date().toString().slice(0, 24),
        html: document.documentElement.className,
        headings: [...document.querySelectorAll('h2, h3')].map((e) => e.textContent.trim()).filter(Boolean),
    }))
    fs.writeFileSync(`${OUT}/${tag}.json`, JSON.stringify(info, null, 1))
    await page.screenshot({ path: `${OUT}/${tag}.png` })
    await page.screenshot({ path: `${OUT}/${tag}-full.png`, fullPage: true })
    if (AFTER) {
        await page.waitForTimeout(AFTER)
        await page.screenshot({ path: `${OUT}/${tag}-after.png` })
    }
    await context.close()
    console.log('ok', tag, '|', info.now, '|', info.html)
}

;(async () => {
    const browser = await chromium.launch()
    if (!flag('--phone-only')) await view(browser, false, false)
    if (!flag('--desk-only')) await view(browser, true, false)
    if (flag('--dark')) await view(browser, false, true)
    await browser.close()
    fs.writeFileSync(`${OUT}/${NAME}-problems.txt`, problems.join('\n'))
    console.log(`${NAME}: ${problems.length} problem(s)`)
})().catch((e) => {
    console.error(e)
    process.exit(1)
})
