import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The genre banner's chips, on the album and artist pages.
//
// Reported off a screenshot ("die Genres sind vom Stil her nicht korrekt"):
// they hand-rolled a plate — `border: 1px solid $mem-line`, no offset shadow —
// so they were the only hairline-framed, flat objects on a screen built from
// 3px frames and hard shadows. They also hovered, while nothing in the row is
// clickable: the design's "you can press this" promise on a caption (the sort
// banner's `.tt` labels made the same call, styling.md).
//
// The other half of that report — the row sitting 12px right of the page's
// leading edge, together with the stat tiles under it — is a rule of its own
// and lives in `leadingEdge.test.ts`.
//
// ⚠️ A source-scanning test goes quietly green when its parser breaks (see
// .claude/rules/testing.md), so every expectation below is paired with a guard
// over its own input.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

const BANNER = "/src/components/AlbumView/GenreBanner.vue";

describe("genre banner anatomy", () => {
  it("builds its chips from the shared sticker, not by hand", () => {
    const source = SOURCES[BANNER];
    expect(source, `${BANNER} not found — did it move?`).toBeTruthy();

    const css = styleBlock(source);
    const [chip] = blocks(css, ".genre-chip");
    // Guard over the input: no block, and every expectation below asserts
    // against an empty string.
    expect(chip, "no `.genre-chip` block — the parser or the file changed").toBeTruthy();

    expect(chip, "a genre chip is a sticker: plate, ink frame, offset shadow").toContain(
      "@include mem-sticker("
    );
    // The two halves the hand-rolled plate got wrong. `mem-sticker` owns both,
    // so restating either here is the drift coming back.
    expect(/(^|[\s;])border:/.test(ownDeclarations(chip)), "the frame belongs to `mem-sticker`").toBe(false);
    expect(/(^|[\s;])box-shadow:/.test(ownDeclarations(chip)), "the offset belongs to `mem-sticker`").toBe(
      false
    );
  });

  it("pairs its static fill with static ink", () => {
    const css = styleBlock(SOURCES[BANNER]);
    const chips = [...blocks(css, ".genre-chip"), ...blocks(css, ".genre-chip.is-label")];
    expect(chips.length, "no chip blocks — the parser or the file changed").toBe(2);

    // `mem-sticker` paints a theme-aware panel and writes the matching
    // theme-aware text colour. Overriding the fill with a STATIC accent without
    // moving the text with it is the pairing failure the token note in
    // _candy.scss warns about — paper-on-lavender in the dark theme.
    const fills = chips.filter(chip => /background-color:\s*\$mem-/.test(chip));
    expect(fills.length, "neither chip overrides the sticker's fill any more").toBe(2);
    expect(
      blocks(css, ".genre-chip")[0],
      "a static accent fill needs static ink on it, in both themes"
    ).toMatch(/color:\s*\$mem-ink/);

    // ⚠️ EVERY chip block, not just the base. The label overrides the fill on
    // its own line, so a `color: $candy-text` written next to it is the same
    // failure one rule further down — with the assertion above still green.
    for (const chip of chips) {
      for (const [, value] of chip.matchAll(/(?:^|[\s;])color:([^;}]+)/g)) {
        expect(value.trim(), "a chip on a static fill carries static ink").toBe("$mem-ink");
      }
    }
  });

  it("nothing is styled as if it could be pressed", () => {
    const css = styleBlock(SOURCES[BANNER]);
    // Genres are labels: no route, no handler, no click. A hover (or the hatch,
    // which says the same thing) is a promise the row cannot keep.
    expect(/:hover/.test(css), "a genre chip is not a control — no hover state").toBe(false);
    expect(/mem-hatch/.test(css), "the hatch means `you can press this`").toBe(false);
  });
});
