// Pick the element a person would click: the first match that is ON SCREEN.
//
// The list pages render through vue-virtual-scroller, and it keeps a pool of
// card views. Views it is not using are parked far outside the page
// (measured on /albums: the first `.album-card` in the DOM at
// top = -999878 px) and stay in the DOM. DOM order is therefore not screen
// order, and `locator(".album-card").first()` regularly resolved to a parked
// card. Playwright cannot scroll a card into view that the scroller itself
// keeps off the page, so the click waited its full 15 s and gave up.
//
// That is why menu-label-fit.js opened only 6 of its 8 menus on every deploy
// (2026-11-26): "album card" and "artist card" (right-click on the first
// card), sometimes "album header" (enter the album by clicking a card) — at any
// load, and still reported MENU_LABEL_FIT_OK.
//
// `firstOnScreen` runs INSIDE the page (Playwright serialises it), so it may
// only use its own arguments. It tags the element it picks with
// `data-gate-target` and returns whether it found one; the Node side then
// clicks `[data-gate-target]`. The second argument exists for the unit test
// (scripts/__tests__/onscreen.test.ts); in the page it is undefined.

function firstOnScreen(selector, env) {
    const doc = env ? env.document : document;
    const width = env ? env.innerWidth : window.innerWidth;
    const height = env ? env.innerHeight : window.innerHeight;

    for (const old of doc.querySelectorAll("[data-gate-target]")) old.removeAttribute("data-gate-target");

    for (const element of doc.querySelectorAll(selector)) {
        const box = element.getBoundingClientRect();
        if (box.width < 1 || box.height < 1) continue;
        // Its centre must be on the page: that is where Playwright clicks.
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        element.setAttribute("data-gate-target", "");
        return true;
    }
    return false;
}

// Node side: wait until a match is on screen (the list mounts after the
// network goes quiet), then hand back a locator for exactly that element.
async function onScreen(page, selector, { timeout = 15000 } = {}) {
    await page.waitForFunction(firstOnScreen, selector, { timeout, polling: 100 });
    return page.locator("[data-gate-target]");
}

module.exports = { firstOnScreen, onScreen };
