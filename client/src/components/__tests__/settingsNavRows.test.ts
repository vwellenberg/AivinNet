import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import settingGroups from "@/settings";

import { block, blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The settings pane list: one glyph per entry, all of them on the chrome grid,
// and a row you can actually hit with a thumb.
//
// Reported from a phone as three things at once, and they were three symptoms
// of the same list never having been looked at as a COLUMN:
//
//   - the rows measured 36px (5px of padding around a 20px glyph) where the
//     rest of the app's chrome is 44px — and here the row IS the tap target
//   - `Albums` and `Album Cover` wore the same record, `Artists` and `Backup`
//     the same person: a reused import reads fine in the source and is
//     obviously wrong in the rendered column
//   - five glyphs (paintbrush, phone, avatar, mic, info) were still the old
//     filled silhouettes, stacked directly under four stroked chrome glyphs
//
// So this census walks the exported tree instead of the source files: the pane
// renders `settingGroups[].groups[]` and nothing else, and the icons are
// already the raw SVG there. A file scan got this wrong in its first draft —
// it found the Last.fm plugin pane, which exists on disk and is not in the
// export, so it is not in the list anyone sees.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");

const ENTRIES = settingGroups.flatMap((category) =>
  category.groups.map((group) => ({ title: group.title ?? "", svg: group.icon ?? "" })),
);

describe("the settings pane list", () => {
  it("finds the entries it is meant to police", () => {
    // The guard over its own input: an empty or half-read tree would leave
    // every assertion below trivially true.
    expect(ENTRIES.map((entry) => entry.title)).toEqual([
      "Appearance",
      "Profile",
      "Pair device",
      "Accounts",
      "Folders",
      "Tracks",
      "Albums",
      "Artists",
      "Album Cover",
      "Backup",
      "Playback",
      "About",
    ]);
  });

  it("gives every entry its own glyph", () => {
    const byGlyph = new Map<string, string[]>();
    for (const { title, svg } of ENTRIES) {
      // Profile is the one entry with no glyph: it renders the user's avatar.
      if (svg === "") continue;
      byGlyph.set(svg, [...(byGlyph.get(svg) ?? []), title]);
    }
    expect(byGlyph.size, "no glyphs read at all").toBeGreaterThan(5);

    const shared = [...byGlyph.values()].filter((titles) => titles.length > 1);
    expect(shared, "two entries wearing one glyph").toEqual([]);
  });

  it("draws every glyph on the 24x24 chrome grid", () => {
    for (const { title, svg } of ENTRIES) {
      if (svg === "") continue;

      expect(svg, `${title} is not on the 24x24 box`).toContain('viewBox="0 0 24 24"');

      const paths = svg.match(/<path\b[^>]*>/g) ?? [];
      expect(paths.length, `${title} has no paths`).toBeGreaterThan(0);
      for (const path of paths) {
        // Both, on EVERY path: the stroke width is the grid, and the colour has
        // to sit on the path itself or the context-menu `fill` rule floods it
        // (styling.md, "Icons nie über `fill` einfärben").
        expect(path, `${title}: a path off the 2.4px grid`).toContain('stroke-width="2.4"');
        expect(path, `${title}: a path without stroke="currentColor"`).toContain(
          'stroke="currentColor"',
        );
      }
    }
  });
});

describe("the settings pane row", () => {
  const SOURCE = read("src/components/modals/settings/Sidebar.vue");
  const SIDEBAR = styleBlock(SOURCE);
  // Not the FIRST `.gitem` block: `.group:first-child` carries a two-line
  // override of the same name above it, and matching that one left every
  // assertion below looking at an empty string.
  const body = blocks(SIDEBAR, ".gitem").find((b) => b.includes("mem-row-plate(")) ?? "";
  const gitem = ownDeclarations(body);

  it("finds the row it is meant to police", () => {
    expect(body, ".gitem not found").not.toBe("");
  });

  it("is a real button", () => {
    // As a div with a @click it was the tap target and NOT a tab stop, which
    // left the whole settings window keyboard-unreachable.
    // `[\s"]` after the class, or `<div class="gitems">` — the wrapper one
    // level up — answers for the row it wraps.
    expect(SOURCE).toMatch(/<button[^>]*class="gitem[\s"]/);
    expect(SOURCE, "a div still carries the row class").not.toMatch(/<div[^>]*class="gitem[\s"]/);
  });

  it("is a 44px tap target, from the chrome token", () => {
    // Every declaration, not "one of them matches": `ownDeclarations` keeps the
    // breakpoint overrides in, and the phone is exactly the case this is FOR —
    // a second `min-height` under `@include largePhones` would put the 36px
    // back and still leave a `toMatch` green.
    expect(gitem.match(/min-height:[^;]*;/g)).toEqual(["min-height: $bar-control;"]);
  });

  it("sizes its glyph from the chrome token too", () => {
    for (const selector of ["svg", ".icon"]) {
      const child = block(body, selector);
      expect(child.body, `${selector} not found`).not.toBe("");
      expect(child.body, `${selector} states a literal glyph size`).toMatch(/\$bar-glyph;/);
    }
  });

  it("separates About with space, not with a rule", () => {
    // The pane's only horizontal cut. On a phone this list fills the screen,
    // and a full-width ink line across it read as the panel being sliced in
    // two rather than as one trailing entry.
    expect(SIDEBAR).not.toMatch(/&\.about::before/);
    expect(ownDeclarations(block(body, "&.about").body)).toMatch(/margin-top:/);
  });
});
