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
  query: "?raw",
  import: "default",
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

  it("keeps the ring narrower than the vertical padding it sits in", () => {
    // A ring as tall as the padding would run the strokes through the letters.
    const rule = block(STYLE, "&.has-route .rinfo").body;
    const ringY = /\$ring-y:\s*([\d.]+)rem/.exec(rule);
    const padY = /padding-block:\s*([\d.]+)rem/.exec(rule);
    expect(ringY, "no $ring-y given").not.toBeNull();
    expect(padY, "no padding-block given").not.toBeNull();
    expect(Number(ringY![1])).toBeLessThan(Number(padY![1]));
  });
});

// A caption cut short on a phone ("Because you liste…" next to "Play mix")
// scrolls instead (user, 2026-11-26), like the player's title. MarqueeText owns
// the ellipsis for text that fits; a second one on the sticker would cut the
// box before the marquee can measure it overflowing.
describe("a caption that does not fit scrolls", () => {
  const TEMPLATE = SOURCE.slice(0, SOURCE.indexOf("<script"));

  it("runs the title and the description through MarqueeText", () => {
    expect(TEMPLATE).toMatch(/<MarqueeText :text="title">\{\{ title \}\}<\/MarqueeText>/);
    expect(TEMPLATE).toMatch(/<MarqueeText :text="description">\{\{ description \}\}<\/MarqueeText>/);
  });

  it("leaves the ellipsis to the marquee", () => {
    const caption = block(STYLE, "> b").body;
    const description = block(STYLE, ".rdesc").body;
    expect(caption, "the caption block was not found").toMatch(/mem-sticker/);
    expect(description, "the description block was not found").toMatch(/mem-sticker/);
    expect(caption).not.toMatch(/text-overflow/);
    expect(description).not.toMatch(/text-overflow/);
  });

  it("lets the caption link shrink below its text, so the marquee gets a narrower box", () => {
    const link = block(STYLE, "> a").body;
    expect(link).toMatch(/display: flex;/);
    expect(link).toMatch(/min-width: 0;/);
  });

  it("lets the running marquee's soft edge stand in for the gap to the glyph", () => {
    // MarqueeText pads running text by 12px; with the gap on top the words sat
    // 20px off the glyph (measured at 390px), against 8px at rest.
    expect(block(STYLE, "&:has(> .marquee.is-running)").body).toMatch(/gap: 0;/);
  });

  it("draws the row glyph before the words, at the lone-glyph size", () => {
    expect(TEMPLATE).toMatch(/<component :is="icon" v-if="icon" class="caption-icon" aria-hidden="true" \/>\s*<MarqueeText/);
    const icon = block(STYLE, ".caption-icon").body;
    expect(icon).toMatch(/width: \$glyph-lone;/);
    expect(icon).toMatch(/height: \$glyph-lone;/);
  });
});
