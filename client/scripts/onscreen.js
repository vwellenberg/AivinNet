// Pick the element a person would click: the first match ON SCREEN, else the
// first one below it — never a pooled view the list parked off the page.
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

    const sized = [...doc.querySelectorAll(selector)].filter((element) => {
        const box = element.getBoundingClientRect();
        return box.width >= 1 && box.height >= 1;
    });
    const centre = (element) => {
        const box = element.getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    };

    // First choice: the centre is on screen, which is where Playwright clicks.
    // Second: below the fold, which Playwright scrolls to (the track rows on
    // /favorites start under the album row). Never ABOVE the page: the gates
    // load each route at the top, so a box up there is a parked view.
    const pick =
        sized.find((element) => {
            const { x, y } = centre(element);
            return x >= 0 && x < width && y >= 0 && y < height;
        }) ||
        sized.find((element) => {
            const { x, y } = centre(element);
            return x >= 0 && x < width && y >= height;
        });
    if (!pick) return false;
    pick.setAttribute("data-gate-target", "");
    return true;
}

// Node side: wait until a match is on screen (the list mounts after the
// network goes quiet), then hand back a locator for exactly that element.
async function onScreen(page, selector, { timeout = 15000 } = {}) {
    await page.waitForFunction(firstOnScreen, selector, { timeout, polling: 100 });
    return page.locator("[data-gate-target]");
}

module.exports = { firstOnScreen, onScreen };
