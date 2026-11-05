// README screenshots from the seeded demo instance (#713).
//
//   node scripts/demo/screenshots.js <outdir> [--url http://127.0.0.1:19800] [--password demo-pass-713]
//
// Needs Playwright (`require('playwright')`). Writes PNGs at 2x; convert them
// with `scripts/demo/README.md` → "Screenshots". The page clock is fixed so
// the shots never pick up a season by accident; the Christmas shot sets its
// own date. Each context logs in, starts an album and pauses it, so the
// player bar shows a real track.
const { chromium } = require('playwright')

const args = process.argv.slice(2)
const OUT = args[0]
if (!OUT) {
    console.error('usage: node scripts/demo/screenshots.js <outdir> [--url URL] [--password PW]')
    process.exit(2)
}
const opt = (name, fallback) => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : fallback
}
const BASE = opt('--url', 'http://127.0.0.1:19800').replace(/\/$/, '')
const PASSWORD = opt('--password', 'demo-pass-713')
const PLAIN_DATE = '2026-11-12T19:30:00' // no season on this day
const CHRISTMAS_DATE = '2026-12-15T19:30:00'
const ALBUM = 'Chrome Coastline' // has synced lyrics, see make_library.py
const PLAYLIST = 'Road Trip Mix'

async function lookup(request) {
    const albums = await (await request.get(`${BASE}/getall/albums?start=0&limit=100`)).json()
    const album = albums.items.find((a) => a.title === ALBUM)
    const playlists = await (await request.get(`${BASE}/playlists`)).json()
    const list = (playlists.data || playlists).find((p) => p.name === PLAYLIST)
    return { album: album.albumhash, artist: album.albumartists[0].artisthash, playlist: list.id }
}

async function open(browser, { phone = false, dark = false, date = PLAIN_DATE } = {}) {
    const context = await browser.newContext({
        viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        isMobile: phone,
        hasTouch: phone,
    })
    const login = await context.request.post(`${BASE}/auth/login`, { data: { username: 'admin', password: PASSWORD } })
    if (!login.ok()) throw new Error(`login failed: ${login.status()}`)
    const page = await context.newPage()
    await page.clock.setFixedTime(new Date(date))
    return { context, page }
}

async function go(page, route, wait = 2500) {
    await page.goto(`${BASE}/#${route}`, { waitUntil: 'load' }) // never networkidle: device sync polls every second
    await page.waitForTimeout(wait)
}

async function snap(page, name) {
    // Park the pointer on bare background, or the last click leaves a hover state behind.
    const { width, height } = page.viewportSize()
    await page.mouse.move(width - 6, Math.round(height * 0.6))
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${OUT}/${name}.png` })
    console.log('ok', name)
}

// Start the album from its header, let it play a moment, pause: the bar shows a track.
async function loadTrack(page, ids, dark) {
    await go(page, `/albums/${ids.album}`)
    await page.locator('.header-actions button').first().click()
    await page.waitForTimeout(2500)
    await page.keyboard.press('Space')
    await page.waitForTimeout(500)
    // The app keeps its own light/dark setting; the browser's colour scheme does not reach it.
    if (dark) {
        await page.locator('.theme-toggle').first().click()
        await page.waitForTimeout(400)
    }
}

;(async () => {
    const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] })
    let ids
    {
        const { context, page } = await open(browser)
        ids = await lookup(context.request)
        await loadTrack(page, ids, false)
        await go(page, '/'); await snap(page, 'home')
        await go(page, `/albums/${ids.album}`); await snap(page, 'album')
        await go(page, `/playlist/${ids.playlist}`); await snap(page, 'playlist')
        await go(page, `/artists/${ids.artist}`); await snap(page, 'artist')
        await go(page, '/stats', 3000)
        await page.getByRole('button', { name: /^year$/i }).first().click()
        await page.waitForTimeout(3000); await snap(page, 'stats')
        await go(page, '/lyrics', 3000); await snap(page, 'lyrics')
        await go(page, '/albums'); await snap(page, 'albums')
        await context.close()
    }
    {
        const { context, page } = await open(browser, { dark: true })
        await loadTrack(page, ids, true)
        await go(page, '/'); await snap(page, 'home-dark')
        await go(page, `/albums/${ids.album}`); await snap(page, 'album-dark')
        await context.close()
    }
    for (const dark of [false, true]) {
        const { context, page } = await open(browser, { phone: true, dark })
        await loadTrack(page, ids, dark)
        const sfx = dark ? '-dark' : ''
        await go(page, '/'); await snap(page, `phone-home${sfx}`)
        if (!dark) {
            await go(page, '/nowplaying/home'); await snap(page, 'phone-nowplaying')
            await go(page, '/lyrics', 3000); await snap(page, 'phone-lyrics')
        }
        await context.close()
    }
    {
        const { context, page } = await open(browser, { date: CHRISTMAS_DATE })
        await loadTrack(page, ids, false)
        await go(page, '/', 4000); await snap(page, 'christmas')
        await context.close()
    }
    await browser.close()
})().catch((err) => {
    console.error(err)
    process.exit(1)
})
