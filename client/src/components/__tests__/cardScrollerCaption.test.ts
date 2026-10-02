import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The caption of a Home row: entity colour and the hatch of a link.
//
// Two reports on one screenshot: "Top artists" had a white caption above coral
// tiles, and "Recently played" is a button without a hatch.
//
// ⚠️ The colour never worked, and nothing said so. The tint was written inside
// `.rtitle` as `.cardscroller.row-is-#{$name} & > b` — and `&` there is the
// WHOLE parent chain, so it compiled to `.cardscroller.row-is-artist
// .cardscroller .rinfo .rtitle > b`: a second `.cardscroller` that does not
// exist. Valid Sass, no warning, no failing test; the class was set on the row
// and no rule ever read it. The rule belongs on the row root.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/components/shared/CardScroller.vue", {
  as: "raw",
  eager: true,
}) as Record<string, string>;
const SOURCE = SOURCES["/src/components/shared/CardScroller.vue"];
const STYLE = styleBlock(SOURCE);

describe("the entity tint of a row caption", () => {
  it("is written on the row root, not behind a second .cardscroller", () => {
    const title = block(STYLE, ".rtitle").body;
    expect(title, "the .rtitle block was not found").not.toBe("");
    // The broken spelling, anywhere in the file.
    expect(STYLE).not.toMatch(/\.cardscroller\.row-is-[^{]*&/);
    expect(title).not.toMatch(/mem-entity-tint/);
    expect(STYLE).toMatch(/&\.row-is-#\{\$name\} \.rinfo \.rtitle > b\s*\{/);
  });

  it("swaps the hatch to the static ink sprite, because the fill is a static pastel", () => {
    const tint = STYLE.slice(STYLE.indexOf("&.row-is-#{$name}"));
    expect(tint).toMatch(/@include mem-entity-tint\(\$name\)/);
    expect(tint).toMatch(/--label-hatch:\s*var\(--mem-hatch-accent\)/);
  });

  it("comes after the hatch, so the sprite swap wins at equal specificity", () => {
    expect(STYLE.indexOf("mem-label-hatch(")).toBeGreaterThan(-1);
    expect(STYLE.indexOf("&.row-is-#{$name}")).toBeGreaterThan(STYLE.indexOf("mem-label-hatch("));
  });
});

describe("the caption link carries the hatch", () => {
  it("only when the row has a route to go to", () => {
    expect(SOURCE).toMatch(/'has-route':\s*!!route/);
    expect(STYLE).toMatch(/&\.has-route \.rinfo\s*\{/);
  });

  it("hatches the caption and the description as a ring around the words", () => {
    const rule = block(STYLE, "&.has-route .rinfo").body;
    expect(rule).toMatch(/\.rtitle > b/);
    expect(rule).toMatch(/\.rdesc > a/);
    expect(rule).toMatch(/@include mem-label-hatch\(/);
  });

  it("keeps the ring narrower than the sticker's vertical padding", () => {
    // mem-sticker pads 0.3rem above and below; a ring as tall as the default
    // 0.6rem would run the strokes through the letters.
    const ringY = /\$ring-y:\s*([\d.]+)rem/.exec(block(STYLE, "&.has-route .rinfo").body);
    expect(ringY, "no $ring-y given").not.toBeNull();
    expect(Number(ringY![1])).toBeLessThan(0.3);
  });
});
