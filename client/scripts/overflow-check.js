// Post-deploy gate: no phone width may force a layout viewport wider than the
// screen. When any element's min-content exceeds the viewport, mobile browsers
// expand the layout viewport to fit it and the whole app renders zoomed-out /
// clipped — reported twice as "the UI is not responsive any more" (#433 at
// 390px, then again at 360px because the verification only measured 390).
//
// Runs headless against the LIVE app (or BASE), across the real phone-width
// spectrum. 390 alone proved worthless: the bar that broke a 360px phone
// measured exactly 390px of min-content and passed there.
//
// Env: TOKEN (required, JWT cookie value) · BASE (default http://localhost:1970)
//      WIDTHS (default 320,360,390,412,430) · ROUTES (default /,search,stats)
// Exit: 0 clean · 1 overflow found · 2 harness error
//
// Playwright is resolved via NODE_PATH (the server keeps it in ~/uitest);
// scripts/deploy-client.sh wires that up and treats a FAIL as a deploy error.
const { chromium } = require("playwright");

(async () => {
  const BASE = process.env.BASE || "http://localhost:1970";
  const widths = (process.env.WIDTHS || "320,360,390,412,430").split(",").map(Number);
  // /stats is here because it is where this gate's blind spot was found: the
  // charts tabs pushed their grid item 50px past the track at 320px and the
  // page cut the tabs, the stat tile and the captions off — with the DOCUMENT
  // still exactly as wide as the screen, so every width reported OK (#558).
  const routes = (process.env.ROUTES || "/,/search/top?q=a,/stats").split(",");
  const browser = await chromium.launch();
  let fail = 0;

  // The boxes that hold a whole route. Listed, because it cannot be inferred:
  // plenty of boxes scroll sideways ON PURPOSE (the stat tiles, the genre
  // chips, the tab plates). `seenBoxes` is what keeps the list honest — see
  // the harness check at the end.
  const PAGE_BOXES = [".content-page", ".search-page-top-results"];
  const seenBoxes = new Set();

  for (const width of widths) {
    const ctx = await browser.newContext({
      viewport: { width, height: 800 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15",
    });
    await ctx.addCookies([
      {
        name: "access_token_cookie",
        value: process.env.TOKEN,
        domain: new URL(BASE).hostname,
        path: "/",
      },
    ]);
    const page = await ctx.newPage();

    for (const route of routes) {
      await page.goto(BASE + "/#" + route, { waitUntil: "networkidle", timeout: 45000 });
      await page.waitForTimeout(2500);
      const m = await page.evaluate((PAGE_BOXES) => {
        const doc = document.documentElement;
        // Report the DEEPEST elements wider than the viewport — everything
        // above them merely stretches to the expanded layout viewport.
        //
        // ⚠️ Run this UNCONDITIONALLY. It used to be gated on the document
        // overflowing, which is exactly the case the page-box check below was
        // added for: there the document measures the screen exactly, so a
        // gated scan finds nothing and the FAIL line names no culprit. A gate
        // that blocks a deploy without a locator is a gate nobody can act on.
        const wide = [];
        document.querySelectorAll("body *").forEach((el) => {
          const rect = el.getBoundingClientRect();
          const kidWide = [...el.children].some(
            (kid) => kid.getBoundingClientRect().width > doc.clientWidth
          );
          if (rect.width > doc.clientWidth && !kidWide) {
            const cls = String(el.className).split(" ").slice(0, 2).join(".");
            wide.push(`${el.tagName}.${cls}=${Math.round(rect.width)}`);
          }
        });
        // ⚠️ The document is not the whole story. A page scrolls in its own
        // box (`overflow: auto`), so content wider than the screen is absorbed
        // into THAT scroll instead of expanding the layout viewport: the doc
        // measures exactly the screen width and the page is cut off anyway.
        // That is how /stats passed this gate at every width while its tabs
        // ran off the screen (#558). A page container that scrolls sideways is
        // the same bug wearing a different number.
        //
        const seen = [];
        const pages = [];
        for (const selector of PAGE_BOXES) {
          for (const el of document.querySelectorAll(selector)) {
            seen.push(selector);
            if (el.scrollWidth > el.clientWidth + 1) {
              pages.push(`${selector}=${el.scrollWidth}/${el.clientWidth}`);
            }
          }
        }
        return { docW: doc.scrollWidth, clientW: doc.clientWidth, wide: wide.slice(0, 6), pages, seen };
      }, PAGE_BOXES);
      const ok = m.docW <= m.clientW + 1 && m.pages.length === 0;
      for (const selector of m.seen) seenBoxes.add(selector);
      if (!ok) fail++;
      console.log(
        `${ok ? "OK  " : "FAIL"} w=${width} route=${route} doc=${m.docW} client=${m.clientW}` +
          // Only on a FAIL: the scan runs always now, and a wide element inside
          // a box that legitimately scrolls (the stat tiles, the tab plates)
          // is not news.
          (!ok && m.wide.length ? " wide: " + m.wide.join(" | ") : "") +
          (m.pages.length ? " page scrolls sideways: " + m.pages.join(" | ") : "")
      );
    }
    await ctx.close();
  }

  await browser.close();

  // ⚠️ A selector that matches nothing checks nothing, quietly. If a page box
  // was never found on any route, this gate has stopped watching it — which is
  // indistinguishable from "everything is fine" in the output above.
  const missed = PAGE_BOXES.filter((selector) => !seenBoxes.has(selector));
  if (missed.length) {
    console.error(`HARNESS: page box never found on any route: ${missed.join(", ")}`);
    process.exit(2);
  }

  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
