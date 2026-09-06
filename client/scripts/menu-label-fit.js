// Every context-menu label, measured against the column it has to fit in.
//
// This is the second time the same defect shipped, from the same cause. The
// menus name their subject since #549 ("Play next" meant the track in one menu
// and the whole album in the one right-click above it), and naming the subject
// makes labels long: #549 itself cut "Add playlist to queue", and #561 shipped
// "Download tracks sepa…". Both times the ellipsis ate the one word that told
// two entries apart, and both times it took a screenshot to notice.
//
// Nothing in the source shows it. The label column takes the row's leftover
// width, the menu is 14rem, and whether a given string fits depends on the
// glyph widths of Space Grotesk. Only a browser knows.
//
// ⚠️ Measured with canvas `measureText`, NOT with `scrollWidth`: on a flex item
// that is already clamped, scrollWidth reports the clamped width, so a
// truncated label measures as though it fit.
//
// Env: TOKEN (required, JWT cookie value) · BASE (default http://localhost:1970)
// Exit: 0 clean · 1 a label is cut · 2 harness error (nothing measured)
let chromium;
try {
    ({ chromium } = require("playwright"));
} catch (error) {
    console.error(`HARNESS: playwright is not resolvable (${error.message}) — set NODE_PATH`);
    process.exit(2);
}

/**
 * Every context menu the app has, and how to open it.
 *
 * `enter` (optional) is a card to click first, for the menus that only exist on
 * a detail page; `open` is what gets clicked — with the right button when
 * `contextmenu` is set, since most of these menus have no button of their own.
 *
 * A target that cannot be opened is reported as a HARNESS line and measures
 * nothing. It must never read as a pass: a gate that quietly covers half of
 * what it claims is how this class of bug survived two rounds.
 */
const TARGETS = [
    { name: "album header", route: "/albums", enter: ".album-card", open: "button.options" },
    { name: "album card", route: "/albums", open: ".album-card", contextmenu: true },
    { name: "artist card", route: "/artists", open: ".artist-card", contextmenu: true },
    { name: "playlist header", route: "/playlists", enter: ".p-card", open: "button.options" },
    { name: "playlist in sidebar", route: "/playlists", open: ".sidebar-playlist-item", contextmenu: true },
    { name: "track row", route: "/favorites", open: ".songlist-item", contextmenu: true },
    { name: "folder row", route: "/folder/$home", open: ".f-item", contextmenu: true },
    { name: "playlist folder in sidebar", route: "/playlists", open: ".sidebar-folder-header", contextmenu: true },
];

(async () => {
    const BASE = process.env.BASE || "http://localhost:1970";

    const browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 } });
    await ctx.addCookies([
        {
            name: "access_token_cookie",
            value: process.env.TOKEN,
            domain: new URL(BASE).hostname,
            path: "/",
        },
    ]);
    const page = await ctx.newPage();

    let measured = 0;
    let fail = 0;
    let opened = 0;

    for (const target of TARGETS) {
        await page.goto(BASE + "/#" + target.route, { waitUntil: "networkidle", timeout: 45000 });

        try {
            if (target.enter) {
                // Lists render through a virtual scroller, so the first card is
                // not there when the network goes quiet.
                await page.locator(target.enter).first().click({ timeout: 15000 });
                await page.waitForTimeout(2500);
            }

            await page.locator(target.open).first().click({
                button: target.contextmenu ? "right" : "left",
                timeout: 15000,
            });
        } catch (error) {
            console.error(`HARNESS: ${target.name} — could not open the menu (${error.message.split("\n")[0]})`);
            continue;
        }

        await page.waitForTimeout(800);

        const labels = await page.evaluate(() => {
            const canvas = document.createElement("canvas").getContext("2d");
            const out = [];

            for (const label of document.querySelectorAll(".context-item > .label")) {
                const box = label.getBoundingClientRect();
                if (!box.width) continue;

                const text = label.textContent.trim();
                canvas.font = getComputedStyle(label).font;

                out.push({
                    text,
                    // The box is what the row actually leaves the label — a
                    // submenu row pays 1.5rem of padding for the chevron sitting
                    // on top of it, and that is already subtracted here.
                    available: Math.round(box.width * 10) / 10,
                    needed: Math.round(canvas.measureText(text).width * 10) / 10,
                });
            }

            return out;
        });

        // Close it again, or the next right-click lands on the open menu.
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);

        if (!labels.length) {
            console.error(`HARNESS: ${target.name} — menu opened but carried no labels`);
            continue;
        }

        opened++;
        let cut = 0;

        for (const label of labels) {
            measured++;
            // Half a pixel of slack: both numbers are fractions, and a label
            // sitting exactly on its limit is not the defect this looks for.
            if (label.needed > label.available + 0.5) {
                cut++;
                fail++;
                console.log(`FAIL ${target.name} — "${label.text}" needs ${label.needed}px, has ${label.available}px`);
            }
        }

        if (!cut) console.log(`OK   ${target.name} — ${labels.length} label(s) measured`);
    }

    await browser.close();

    console.log(`\n${measured} label(s) measured across ${opened} of ${TARGETS.length} menu(s)`);

    if (!measured) {
        console.error("HARNESS: measured nothing — no menu could be opened");
        process.exit(2);
    }
    process.exit(fail ? 1 : 0);
})().catch(error => {
    console.error(`HARNESS: ${error.message}`);
    process.exit(2);
});
