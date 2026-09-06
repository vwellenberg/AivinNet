// Every caption on a page, measured against the block it labels.
//
// The design has one rule about leading edges: a section caption, the cards or
// rows under it, and the page head all start on the SAME line (styling.md, "Der
// Sticker fluchtet links"). Drift off that line is invisible in isolation —
// each element looks fine in its own file and its own screenshot — and only
// shows next to a page that does it right. It was reported twice from user
// screenshots (#526 "Up Next"/"Queue" 16px out, #528 six page titles 12px out)
// before anything measured it.
//
// So this measures it. For every sticker caption on a page it finds the first
// following block wide enough to BE the section (>=40% of the content width:
// the list, the grid, the plate) and reports any difference between the two
// left edges. It also reports a chip padded unevenly, which is the same
// leftover in the other box (a caption's chip grows inwards instead of moving).
//
// Env: TOKEN (required, JWT cookie value) · BASE (default http://localhost:1970)
//      WIDTH (default 1440) · ROUTES (default: the list pages; pass detail
//      routes like /albums/<hash> to include them) · MIN_COMPARED (default 8,
//      the floor under which a run counts as broken rather than clean)
// Exit: 0 clean · 1 drift found · 2 harness error (nothing meaningful measured)
//
// Playwright is resolved via NODE_PATH, same as scripts/overflow-check.js.
//
// ⚠️ This is the check the source censuses cannot be: padding that arrives
// through a mixin, a selector built by interpolation and Sass arithmetic are
// all invisible to a source scan, and all perfectly visible here.
// Resolved defensively: this throws at MODULE scope, before the async body
// below, so the `.catch` at the bottom cannot see it — node would exit 1 and
// the caller would read "drift found" from a script that never ran. The
// deploy's `[[ -d node_modules/playwright ]]` guard proves a directory exists,
// not that the module resolves.
let chromium;
try {
  ({ chromium } = require("playwright"));
} catch (error) {
  console.error(`HARNESS: playwright is not resolvable (${error.message}) — set NODE_PATH`);
  process.exit(2);
}

const DEFAULT_ROUTES = [
  "/",
  "/albums",
  "/artists",
  "/playlists",
  "/favorites",
  "/folder/$home",
  "/stats",
  "/search/top?q=a",
  "/nowplaying/home",
];

(async () => {
  const BASE = process.env.BASE || "http://localhost:1970";
  const width = Number(process.env.WIDTH || 1440);
  const routes = (process.env.ROUTES || DEFAULT_ROUTES.join(",")).split(",");

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width, height: 950 } });
  await ctx.addCookies([
    {
      name: "access_token_cookie",
      value: process.env.TOKEN,
      domain: new URL(BASE).hostname,
      path: "/",
    },
  ]);
  const page = await ctx.newPage();
  let fail = 0;
  let measured = 0;

  for (const route of routes) {
    await page.goto(BASE + "/#" + route, { waitUntil: "networkidle", timeout: 45000 });
    await page.waitForTimeout(3200);

    const captions = await page.evaluate(() => {
      const round = (n) => Math.round(n * 10) / 10;
      const out = [];

      // The caption carriers. `.rtitle > b` and not `.rtitle`: the card-row
      // caption is a bare flex row and the chip is on the <b> inside it, so
      // matching the row measured nothing and still printed a clean line.
      const CARRIERS = "h1, h2, h3, .rtitle > b, .btitle, .np-sticker";

      for (const cap of document.querySelectorAll(CARRIERS)) {
        const box = cap.getBoundingClientRect();
        if (!box.width || !box.height) continue;

        // A sticker: its own border AND its own surface. A bare title inside a
        // card or a panel is not what the leading-edge rule is about.
        const style = getComputedStyle(cap);
        const isSticker =
          parseFloat(style.borderLeftWidth) >= 1 && style.backgroundColor !== "rgba(0, 0, 0, 0)";
        if (!isSticker) continue;

        // The block this caption labels: the first following sibling wide
        // enough to be the section, walking up until the page container.
        let reference = null;
        let node = cap;
        while (node && !reference) {
          // Stop BEFORE scanning this level, not after: at the page container
          // the siblings are the sidebar and the player bar, and the bar is
          // full-width, tall and at left 0 — it passed the filter below and
          // reported ~300px of drift on a flush caption. `body` is the backstop
          // for roots that carry none of these classes.
          if (node === document.body) break;
          if (node.matches && node.matches(".v-scroll-page, .content-page, #acontent")) break;

          let sibling = node.nextElementSibling;
          while (sibling) {
            const rect = sibling.getBoundingClientRect();
            const parentWidth = (node.parentElement || document.body).getBoundingClientRect().width;
            // Skip the virtual scroller's own machinery — a resize-observer
            // probe is not content, and taking it as the reference reported
            // 32px of drift on a row that measures flush.
            const technical = /resize-observer/.test(String(sibling.className));
            if (!technical && rect.width >= parentWidth * 0.4 && rect.height > 8) {
              reference = rect;
              break;
            }
            sibling = sibling.nextElementSibling;
          }
          node = node.parentElement;
        }

        out.push({
          text: (cap.textContent || "").trim().slice(0, 26),
          left: round(box.left),
          referenceLeft: reference ? round(reference.left) : null,
          drift: reference ? round(box.left - reference.left) : null,
          padding: [style.paddingLeft, style.paddingRight],
        });
      }
      return out;
    });

    let routeFailed = false;
    for (const caption of captions) {
      const offEdge = caption.drift !== null && Math.abs(caption.drift) > 1;
      const lopsided = caption.padding[0] !== caption.padding[1];
      if (!offEdge && !lopsided) continue;
      fail++;
      routeFailed = true;
      console.log(
        `FAIL ${route} "${caption.text}" left=${caption.left} ref=${caption.referenceLeft}` +
          (offEdge ? ` OFF BY ${caption.drift}` : "") +
          (lopsided ? ` LOPSIDED PADDING ${caption.padding[0]}/${caption.padding[1]}` : "")
      );
    }
    // COMPARED, not found: a caption with no block under it was never measured
    // against anything, and counting it as checked is how a broken run looks
    // clean. With a nonsense TOKEN the app renders its full shell — sidebar,
    // sort chips, page title — and no data, so the titles are still found and
    // there is nothing to compare them to.
    const compared = captions.filter(caption => caption.drift !== null).length;
    measured += compared;

    // OK and FAIL are mutually exclusive per route, as in overflow-check.js.
    if (!routeFailed) {
      const skipped = captions.length - compared;
      console.log(
        `OK   ${route} — ${compared} caption(s) compared` +
          (skipped ? `, ${skipped} with no block to compare against` : "")
      );
    }
  }

  await browser.close();

  console.log(`\n${measured} caption(s) compared across ${routes.length} route(s)`);

  // How much had to be measured for the run to mean anything. "At least one"
  // is not enough: with a nonsense TOKEN the app still renders its shell, and
  // two captions on static pages compared fine while every data-driven route
  // was empty — a wall of OK for a run that checked nothing that matters
  // (measured: 21 comparisons on a populated library, 2 on a locked-out one).
  //
  // A real library well below this floor is a broken run too — an empty
  // library cannot answer the question this script asks.
  // Drift outranks the floor. A run can find real FAILs and still fall under
  // it (a half-loaded library, a route that timed out), and reporting that as
  // "measured nothing" would hand the caller a green deploy with the findings
  // printed right above it — the one outcome worse than not running at all.
  if (fail) process.exit(1);

  const floor = Number(process.env.MIN_COMPARED || 8);
  if (measured < floor) {
    console.error(
      `HARNESS: only ${measured} comparison(s), expected at least ${floor} — ` +
        "check TOKEN and BASE, or lower MIN_COMPARED if the library really is this small"
    );
    process.exit(2);
  }
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
