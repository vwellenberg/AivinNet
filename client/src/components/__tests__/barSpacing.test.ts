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
  [
    "/src/components/BottomBar/Left.vue",
    ".bar-controls",
    "$bar-gap-tight",
    "transport + devices — two buttons side by side, so the transport's own spacing",
  ],
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

  // -------------------------------------------------------------------------
  // The phone bar's control row: it HOLDS the transport, so it has to space
  // like the transport. Asserted as a relation between the two files rather
  // than as a literal token, because the failure this catches is a drift —
  // someone retunes the transport's phone gap and the devices button, which is
  // in the same visual row of four plated buttons, silently keeps the old one.
  // -------------------------------------------------------------------------
  const LEFT = "/src/components/BottomBar/Left.vue";
  const HOTKEYS = "/src/components/LeftSidebar/NP/HotKeys.vue";

  it("spaces the phone bar's control row exactly like the transport inside it", () => {
    const phoneTransport = block(block(styleBlock(SOURCES[HOTKEYS]), ".hotkeys").body, "@include allPhones").body;
    expect(phoneTransport, "no `@include allPhones` block in .hotkeys — did the transport lose its phone gap?").not.toBe(
      ""
    );

    const transportGap = /(?:^|[\s;{])gap\s*:\s*([^;]+);/.exec(phoneTransport);
    const rowGap = /(?:^|[\s;{])gap\s*:\s*([^;]+);/.exec(block(styleBlock(SOURCES[LEFT]), ".bar-controls").body);
    expect(transportGap, "the transport states no phone `gap`").toBeTruthy();
    expect(rowGap, "`.bar-controls` states no `gap`").toBeTruthy();

    expect(
      (rowGap as RegExpExecArray)[1].trim(),
      "`.bar-controls` holds the transport plus the devices button, so the space between " +
        "`next` and `devices` has to be the space between `prev` and `play` — measured at 375px " +
        "before #159 it was 8px against 12px, because the devices button was a sibling of the " +
        "transport and took the row's BLOCK gap instead."
    ).toBe((transportGap as RegExpExecArray)[1].trim());
  });

  it("keeps the transport and the devices button in that ONE row", () => {
    const template = SOURCES[LEFT].slice(0, SOURCES[LEFT].indexOf("<script"));
    const row = template.indexOf('class="bar-controls"');
    const transport = template.indexOf("<HotKeys");
    const devices = template.indexOf("<DevicesButton");

    expect(row, "no `.bar-controls` row in the phone bar's template").toBeGreaterThan(-1);
    expect(row, "`.bar-controls` has to OPEN before the transport it holds").toBeLessThan(transport);
    expect(transport, "the devices button stands after the transport in this row").toBeLessThan(devices);
    // The gap rule above is worth nothing if the two buttons end up in
    // different rows again — then each takes its own row's spacing and the
    // seam is back, with both `gap` declarations still reading their token.
    expect(
      template.slice(transport, devices),
      "the devices button left the control row — it is a control, not a block, so it is spaced " +
        "by the row that holds the transport (#159)"
    ).not.toContain("</div>");
  });
});
