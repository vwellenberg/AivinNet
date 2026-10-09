import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The stamp hangs over the corner of a tile's artwork. `.card-art` clips its
// children (`overflow: hidden`), so a stamp inside it only survives when the
// art opts out via `.has-stamp` — and then the picture has to take over the
// rounded corners the clip used to cut. Neither half fails loudly: the stamp
// just renders cut off, or the cover pokes square corners out of the frame.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;
const anatomy = readFileSync("src/assets/scss/Global/cards.scss", "utf8");

describe("card stamp", () => {
  const users = Object.entries(SOURCES).filter(
    ([path, src]) => !path.endsWith("/CardStamp.vue") && /<CardStamp\b/.test(src)
  );

  it("is used by at least one tile", () => {
    expect(users.length).toBeGreaterThan(0);
  });

  it("is only placed inside an art box that opts out of the clip", () => {
    for (const [path, src] of users) {
      expect(src, path).toMatch(/card-art[^>]*has-stamp/);
    }
  });

  it("gives the clipped corners to the picture when the art stops clipping", () => {
    const block = anatomy.match(/\.card-art\.has-stamp\s*\{[^]*?\n\}/)?.[0] ?? "";
    expect(block).toMatch(/overflow:\s*visible/);
    expect(block).toMatch(/> img\s*\{[^}]*border-radius/);
  });

  it("never intercepts the tile's click", () => {
    const stamp = SOURCES["/src/components/shared/CardStamp.vue"];
    expect(stamp).toMatch(/pointer-events:\s*none/);
  });
});
