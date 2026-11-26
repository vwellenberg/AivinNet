// Wait for a page to come to rest before a gate measures it.
//
// The post-deploy gates (edge-audit.js, overflow-check.js) used to measure
// after a FIXED pause. That only works while the server is idle. A deploy
// runs right after a backend restart, often while other jobs load the same
// machine, and then the entrance animations start late: the section stickers
// "slap" in (`mem-sticker-slap`, scaled 1.2 and turned), and at the fixed
// 3.2 s mark the edge audit measured that tilted, oversized box. Its left
// edge sat 6–24 px left of the block it labels — more for a longer caption,
// the signature of a rotation, not of padding. Five deploys in a row failed
// on captions that measure flush at rest (2026-11-25: Favorites, Stats,
// Playlists, Search), and each run named different pages, because which
// sticker was still in flight depended on the load at that moment.
//
// So a gate measures the RESTING page: after its pause it waits here until no
// finite animation or transition is running (or about to), and has stayed so
// for a short quiet window. Infinite animations (the marquee, the season
// particles) never end and are not what moves a layout into place, so they
// are ignored. A page that will not settle in time has its remaining finite
// animations finished (see `settle` below), and the caller says so — a gate
// that silently skips is how this class of bug ships.
//
// `untilAnimationsRest` runs INSIDE the page (Playwright serialises it), so it
// may only use its own arguments. The second argument exists for the unit
// test (scripts/__tests__/settle.test.ts); in the page it is undefined.

async function untilAnimationsRest(options, env) {
  const timeout = options.timeout;
  const quiet = options.quiet;
  const getAnimations = env ? env.getAnimations : () => document.getAnimations();
  const now = env ? env.now : () => performance.now();
  const sleep = env ? env.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const busyNow = () =>
    getAnimations().filter((animation) => {
      const timing = animation.effect && animation.effect.getComputedTiming();
      const finite = Boolean(timing) && Number.isFinite(timing.endTime);
      return finite && (animation.playState === "running" || animation.pending === true);
    });

  const deadline = now() + timeout;
  let quietSince = null;
  for (;;) {
    const busy = busyNow();
    if (busy.length === 0) {
      if (quietSince === null) quietSince = now();
      if (now() - quietSince >= quiet) return { settled: true, running: [] };
    } else {
      quietSince = null;
    }
    if (now() >= deadline) {
      if (busy.length === 0) return { settled: true, running: [] };
      const names = busy.map(
        (animation) => animation.animationName || animation.transitionProperty || animation.id || "animation"
      );
      return { settled: false, running: [...new Set(names)] };
    }
    await sleep(50);
  }
}

// Node side: the gates call this right before they measure a route.
//
// If the page does not come to rest in time, the finite animations still in
// flight are FINISHED, so the gate measures their end state rather than a
// frame of them. A throttled renderer can leave an animation "running" at
// currentTime 0 for good (docs/verification.md, "Fallen beim Messen": btn-pop
// made every plated button 8 px narrow) — waiting longer would not help there.
async function settle(page, { timeout = 15000, quiet = 500 } = {}) {
  const rest = await page.evaluate(untilAnimationsRest, { timeout, quiet });
  if (!rest.settled) {
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) {
        const timing = animation.effect && animation.effect.getComputedTiming();
        if (timing && Number.isFinite(timing.endTime)) animation.finish();
      }
    });
  }
  return rest;
}

module.exports = { settle, untilAnimationsRest };
