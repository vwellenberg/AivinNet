import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

import { TRACK_BAND_COUNT, TRACK_BAND_MIN_FADE, trackBandClass, trackBandFade } from "../songItemMethods";

// ---------------------------------------------------------------------------
// The colour guide band on the leading edge of a track row alternates two
// accents, and the cycle is computed in JS rather than written as `:nth-child`.
//
// That is not a style preference. Track lists render through
// vue-virtual-scroller, which RECYCLES its row elements: DOM position inside
// the scroller follows the scroll offset, not the list, so an nth-child rule
// repaints on every tick and hands the same track a different colour each time.
// A test rather than a comment because the nth-child version is the obvious one
// to reach for, looks right in a static screenshot, and only misbehaves while
// scrolling.
//
// The second half of the pairing is in SCSS: `mem-band-cycle` emits one
// `band-N` rule per entry in `$mem-band-colours`. A class with no matching rule
// leaves that row with no band at all — silently, since `--band` just falls
// back — so the two counts are checked against each other here.
// ---------------------------------------------------------------------------

// `.scss` has to come through `fs`: a raw glob returns an EMPTY string for
// stylesheets, which would make this test silently green
// (.claude/rules/testing.md).
const CANDY = readFileSync("src/assets/scss/_candy.scss", "utf-8");

describe("trackBandClass", () => {
  it("alternates the two accents", () => {
    expect([0, 1, 2, 3, 4].map(trackBandClass)).toEqual([
      "band-0",
      "band-1",
      "band-0",
      "band-1",
      "band-0",
    ]);
  });

  it("accepts the string ordinals the prop's type allows", () => {
    // `index` is typed `number | string`; ArtistTracks and the search view pass
    // it straight through from their own counters.
    expect(trackBandClass("7")).toBe("band-1");
    expect(trackBandClass("12")).toBe("band-0");
  });

  it("never emits a negative class", () => {
    // `TopTracks.vue` numbers backwards from a `total` (`total - index`), which
    // Favorites.vue feeds from its API count. The moment MORE rows are rendered
    // than that count claims — a stale or capped count against a longer loaded
    // list — `index` passes `total` and the ordinal goes negative. `band--2`
    // matches no rule, which would drop the band on exactly those rows.
    for (const n of [-1, -4, -5, -6, -13]) {
      const cls = trackBandClass(n);
      expect(cls).toMatch(/^band-[01]$/);
    }
  });

  it("falls back to the first accent for an unparseable ordinal", () => {
    // A row with no band at all reads as broken; a row sharing its neighbour's
    // colour just reads as a repeat.
    expect(trackBandClass("")).toBe("band-0");
    expect(trackBandClass("—")).toBe("band-0");
    expect(trackBandClass(NaN)).toBe("band-0");
  });

  it("has one SCSS accent per class it can emit", () => {
    const list = CANDY.match(/\$mem-band-colours:\s*([^;]+);/);
    expect(list, "$mem-band-colours is gone from _candy.scss").toBeTruthy();

    const colours = list![1].split(",").map((c) => c.trim()).filter(Boolean);
    expect(colours).toHaveLength(TRACK_BAND_COUNT);

    // Every accent is a token, never a literal — brand colours have one source
    // (src/brand-colors.json, injected into the $mem-* names).
    for (const colour of colours) {
      expect(colour, `${colour} should be a $mem-* token`).toMatch(/^\$mem-/);
    }
  });

  it("emits the band classes from the shared cycle mixin, not by hand", () => {
    // The `@for` in mem-band-cycle is what keeps the class count tied to the
    // colour list. Spelling the rules out again would let the two drift.
    expect(CANDY).toMatch(/@mixin\s+mem-band-cycle/);
    expect(CANDY).toMatch(/&\.band-#\{\$i - 1\}/);
  });
});

describe("trackBandFade", () => {
  it("runs from the floor at the top to full strength at the bottom", () => {
    expect(trackBandFade(1, 10)).toBe(TRACK_BAND_MIN_FADE);
    expect(trackBandFade(10, 10)).toBe(1);
    // Monotonic in between — the whole point is a readable gauge.
    const fades = [1, 2, 3, 4, 5].map((p) => trackBandFade(p, 5));
    expect([...fades].sort((a, b) => a - b)).toEqual(fades);
  });

  it("is 1 without a usable total", () => {
    // Mixed/paginated sources (search) have no stable total; a uniform
    // full-strength band is the fallback, never an invisible one.
    expect(trackBandFade(3)).toBe(1);
    expect(trackBandFade(3, 0)).toBe(1);
    expect(trackBandFade(3, 1)).toBe(1);
    expect(trackBandFade(NaN, 10)).toBe(1);
  });

  it("clamps positions outside the claimed total", () => {
    // A list shorter or longer than its claimed total (stale count while
    // pages stream in) must not push the fade outside [floor, 1].
    expect(trackBandFade(0, 10)).toBe(TRACK_BAND_MIN_FADE);
    expect(trackBandFade(999, 10)).toBe(1);
  });

  it("keeps the floor visible", () => {
    // 0 would make row 1 the only row without a spine.
    expect(TRACK_BAND_MIN_FADE).toBeGreaterThan(0);
    expect(TRACK_BAND_MIN_FADE).toBeLessThan(1);
  });
});
