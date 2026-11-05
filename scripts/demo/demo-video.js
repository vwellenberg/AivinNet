// The README's demo clip from the seeded demo instance (#713): a short tour
// Home → Albums → an album → play → lyrics, recorded as WebM.
//
//   node scripts/demo/demo-video.js <outdir> [--url http://127.0.0.1:19800] [--password demo-pass-713]
//
// Turn the WebM into the README GIF with the ffmpeg line in scripts/demo/README.md.
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const OUT = args[0]
if (!OUT) {
    console.error('usage: node scripts/demo/demo-video.js <outdir> [--url URL] [--password PW]')
    process.exit(2)
}
const opt = (name, fallback) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : fallback
}
const BASE = opt('--url', 'http://127.0.0.1:19800').replace(/\/$/, '')
const PASSWORD = opt('--password', 'demo-pass-713')
const SIZE = { width: 1280, height: 800 }

;(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
    // Log in on a context that does not record, so the clip starts on a finished page.
    const auth = await browser.newContext()
    const login = await auth.request.post(`${BASE}/auth/login`, { data: { username: 'admin', password: PASSWORD } })
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
    const storageState = await auth.storageState()
    await auth.close()

    const context = await browser.newContext({
        viewport: SIZE,
        storageState,
        recordVideo: { dir: OUT, size: SIZE },
    })
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date('2026-11-12T19:30:00')) // no season on this day
    await page.goto(`${BASE}/#/`, { waitUntil: 'load' })
    await page.waitForTimeout(2500)

    await page.mouse.move(700, 450)
    await page.mouse.wheel(0, 500)
    await page.waitForTimeout(1500)
    await page.mouse.wheel(0, -500)
    await page.waitForTimeout(800)

    await page.locator('a[href="#/albums"]').first().click()
    await page.waitForTimeout(1800)
    await page.getByText('Chrome Coastline', { exact: true }).first().click()
    await page.waitForTimeout(2000)
    await page.locator('.header-actions button').first().click()
    await page.mouse.move(SIZE.width - 6, 480) // off the rows: a parked pointer would hover a lyric line
    await page.waitForTimeout(1500)

    // A hash change, not a goto: reloading the page would stop the track.
    await page.evaluate(() => { window.location.hash = '#/lyrics' })
    await page.waitForTimeout(5000)

    await page.close() // closing the page finishes the video file
    await context.close()
    await browser.close()
    console.log('video written to', OUT)
})().catch((err) => {
    console.error(err)
    process.exit(1)
})
