import { describe, expect, it } from "vitest";

import { block, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The player bar has ONE spacing value, and every group of it reads the token.
//
// Measured on the running app before this test existed, the bar carried three:
// 20px between the transport controls, 12px in the track block, and 2px on the
// right, where lyrics, devices and the speaker stand. That is the drift #387
// removed for SIZES, one level out — each group spaced itself, and the odd one
// out is invisible until the buttons get a fill: a 24px glyph in a 44px box
// brings 10px of padding of its own, so bare glyphs look evenly spaced at any
// gap. Give them a frame and the right-hand three read as one welded block.
//
// Counting the groups rather than naming the broken one: a fifth group added
// later fails here until it decides where its spacing comes from.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

/** Every bar group and the selector its spacing lives on. */
const GROUPS: [file: string, selector: string, token: string, what: string][] = [
  ["/src/components/BottomBar/Left.vue", ".left-group", "$bar-gap", "the track block"],
  ["/src/components/LeftSidebar/NP/HotKeys.vue", ".hotkeys", "$bar-gap", "the transport row"],
  ["/src/components/BottomBar/Right.vue", ".right-group", "$bar-gap", "lyrics and devices"],
  [
    "/src/components/BottomBar/Volume.vue",
    ".b-bar .right-group .volume-control",
    "$bar-gap-tight",
    "speaker and slider — one control, so tighter on purpose",
  ],
];

describe("player bar spacing", () => {
  it.each(GROUPS)("%s › %s reads %s (%s)", (file, selector, token) => {
    const source = SOURCES[file];
    expect(source, `${file} not found — did it move?`).toBeTruthy();

    const body = block(styleBlock(source), selector).body;
    expect(body, `no \`${selector} { … }\` block in ${file}`).not.toBe("");

    // The first `gap:` is the group's own; a breakpoint may narrow it further
    // and states its own value inside a nested block.
    const gap = /(?:^|[\s;{])gap\s*:\s*([^;]+);/.exec(body);
    expect(gap, `\`${selector}\` in ${file} states no \`gap\``).toBeTruthy();
    expect(
      (gap as RegExpExecArray)[1].trim(),
      `\`${selector}\` should space itself from ${token}, not from a literal — the bar had three ` +
        "different gaps before this token existed."
    ).toBe(token);
  });

  it("leaves no hand-written pixel gap in the bar", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([path]) => path.includes("/BottomBar/"))
      .flatMap(([path, source]) =>
        [...styleBlock(source).matchAll(/(?:^|[\s;{])gap\s*:\s*(\d+px)/g)].map(m => `${path}: gap: ${m[1]}`)
      );
    expect(offenders, `a bar group is spacing itself in pixels again`).toEqual([]);
  });

  // ⚠️ The two above between them still let one shape through: a BREAKPOINT gap
  // written as a generic spacing token. The first reads only a group's OPENING
  // `gap:`, and the second only rejects literal pixels — so
  // `@include largePhones { gap: $small }` passed both while being a fourth bar
  // spacing next to the three named ones. That is the same unowned-value drift
  // one level in, and a breakpoint block is exactly where the phone row's
  // `gap: 0` sat unnoticed until the devices button got a fill.
  //
  // Scoped to the GROUPS above, not to `/BottomBar/`: `BottomBar.vue` also has
  // gaps, but they space the stacked ROWS of the phone bar (track / seek /
  // navigation), which is a different question from how far apart two controls
  // stand.
  it.each(GROUPS)("%s › %s spaces its breakpoints from a bar token too", (file, selector) => {
    const BAR_TOKENS = ["$bar-gap", "$bar-gap-tight", "$bar-gap-phone"];

    const body = ownDeclarations(block(styleBlock(SOURCES[file]), selector).body);
    expect(body, `no \`${selector} { … }\` block in ${file}`).not.toBe("");

    const offenders = [...body.matchAll(/(?:^|[\s;{])gap\s*:\s*([^;]+);/g)]
      .map(m => m[1].trim())
      .filter(value => !BAR_TOKENS.includes(value));

    expect(
      offenders,
      `\`${selector}\` states a gap that belongs to no bar token. Breakpoint overrides count — ` +
        "a generic $small or a bare rem here is a spacing nobody owns; give it a name in " +
        "Global/_buttons.scss like the three that do."
    ).toEqual([]);
  });
});
