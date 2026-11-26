// Wait for a page to come to rest before a gate measures it.
//
// The post-deploy gates (edge-audit.js, overflow-check.js) used to measure
// after a FIXED pause. That only works while the server is idle. A deploy
// runs right after a backend restart, often while other jobs load the same
// machine, and then the page renders late: the section stickers "slap" in
// (`mem-sticker-slap`, first keyframe translateY(-16px) rotate(-11deg)
// scale(1.22)) only once their section arrives, and the edge audit measured
// that first keyframe — a box 6–24 px left of the block it labels, more for a
// longer caption, the signature of a rotation and not of padding. Five
// deploys in a row failed on captions that measure flush at rest (2026-11-25:
// Favorites, Stats, Playlists, Search), each run naming different pages,
// because what was still arriving depended on the load at that moment.
//
// "At rest" therefore means BOTH, for a quiet window:
//   - no finite animation or transition running or about to start, and
//   - no node added or removed anywhere in the document.
// The second matters as much as the first: under load the section mounts
// AFTER an animation-only check has already seen a still page, and its
// sticker then starts from keyframe 0 right before the measurement.
// Infinite animations (the marquee, the season particles) never end and do
// not move a layout into place, so they are ignored.
//
// If the page does not rest in time, the finite animations still in flight
// are FINISHED and the wait runs again — finishing the page's own entrance
// can mount content, which starts new arrivals. A throttled renderer can also
// hold an animation at currentTime 0 for good (docs/verification.md, "Fallen
// beim Messen": btn-pop made every plated button 8 px narrow), and waiting
// longer would not help there. The caller prints a WARN line either way — a
// gate that quietly measures something else is how this class of bug ships.
//
// `untilPageRests` runs INSIDE the page (Playwright serialises it), so it may
// only use its own arguments. The second argument exists for the unit test
// (scripts/__tests__/settle.test.ts); in the page it is undefined.

async function untilPageRests(options, env) {
  const timeout = options.timeout;
  const quiet = options.quiet;
  const now = env ? env.now : () => performance.now();
  const sleep = env ? env.sleep : (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const getAnimations = env ? env.getAnimations : () => document.getAnimations();

  // Last time a node was added or removed. childList only: an attribute or a
  // text node that ticks (a clock, a progress bar) is not content arriving.
  let lastMutation = now();
  let observer = null;
  if (env) {
    lastMutation = env.lastMutation();
  } else {
    observer = new MutationObserver(() => {
      lastMutation = now();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }
  const mutatedAt = () => (env ? env.lastMutation() : lastMutation);

  const busyNow = () =>
    getAnimations().filter((animation) => {
      const timing = animation.effect && animation.effect.getComputedTiming();
      const finite = Boolean(timing) && Number.isFinite(timing.endTime);
      return finite && (animation.playState === "running" || animation.pending === true);
    });

  try {
    const deadline = now() + timeout;
    let quietSince = null;
    for (;;) {
      const busy = busyNow();
      const t = now();
      if (busy.length === 0) {
        // Quiet runs from whichever came last: the end of the animations or the last mutation.
        if (quietSince === null) quietSince = t;
        const since = Math.max(quietSince, mutatedAt());
        if (t - since >= quiet) return { settled: true, running: [] };
      } else {
        quietSince = null;
      }
      if (t >= deadline) {
        const names = busy.map(
          (animation) => animation.animationName || animation.transitionProperty || animation.id || "animation"
        );
        return { settled: false, running: names.length ? [...new Set(names)] : ["DOM still changing"] };
      }
      await sleep(50);
    }
  } finally {
    if (observer) observer.disconnect();
  }
}

function finishFiniteAnimations() {
  for (const animation of document.getAnimations()) {
    const timing = animation.effect && animation.effect.getComputedTiming();
    if (timing && Number.isFinite(timing.endTime)) animation.finish();
  }
}

// Node side: the gates call this right before they measure a route. Returns
// the FIRST wait's verdict (what the WARN line reports); `forced` says the
// remaining animations had to be finished, possibly more than once.
async function settle(page, { timeout = 15000, quiet = 700, retries = 2 } = {}) {
  const first = await page.evaluate(untilPageRests, { timeout, quiet });
  let rest = first;
  let forced = false;
  for (let attempt = 0; !rest.settled && attempt < retries; attempt++) {
    forced = true;
    await page.evaluate(finishFiniteAnimations);
    rest = await page.evaluate(untilPageRests, { timeout: 5000, quiet });
  }
  if (!rest.settled) await page.evaluate(finishFiniteAnimations);
  return { settled: first.settled, running: first.running, forced };
}

module.exports = { settle, untilPageRests };
