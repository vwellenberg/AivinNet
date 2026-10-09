import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// Label buttons carry the hatch too — as a ring around the label.
//
// Reported on the charts screen: "buttons here have no hatch". The texture
// means "you can press this" (styling.md), and #476 had taken it off every
// button whose face is a WORD — tabs, chips, pills, text buttons — because it
// must never run behind text and the ring then needed a cover in the button's
// own fill for every state. Measured with the census script in the PR: 8 kinds
// of pressable plate across the app had no texture — the charts and
// discography tabs, the search tabs, the sort chips, "New Playlist" (every
// pill), the folder sort opener, the chart page-size chips and the playlist
// "Edit" button; the settings segments had it on the active one only.
//
// `mem-label-hatch` paints the texture on a `::before` that masks out its own
// content box, so no fill has to be restated anywhere: the strokes only stand
// in the ring, and whatever colour the button has shows through the hole.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const CANDY = strip(read("src/assets/scss/_candy.scss"));
const BUTTONS = strip(read("src/assets/scss/Global/_buttons.scss"));

function mixin(css: string, name: string): string {
  const start = css.indexOf(`@mixin ${name}(`);
  expect(start, `@mixin ${name} not found`).toBeGreaterThan(-1);
  const next = css.indexOf("\n@mixin ", start + 1);
  return css.slice(start, next === -1 ? undefined : next);
}

describe("mem-label-hatch", () => {
  const body = mixin(CANDY, "mem-label-hatch");

  it("paints on a pseudo-element, not on the button's own background", () => {
    // On the button itself it would need a cover in the button's fill — the
    // `--row-fill` coupling that made #476 drop the texture altogether.
    expect(body).toMatch(/&::before\s*\{/);
    expect(body).not.toMatch(/--row-fill/);
  });

  it("cuts the text band out of the texture", () => {
    // Both spellings: the unprefixed one for current engines, the -webkit- one
    // for the Android WebViews that still need it.
    expect(body).toMatch(/mask:\s*linear-gradient\([^)]*\)\s*content-box\s+exclude/);
    expect(body).toMatch(/-webkit-mask-composite:\s*xor;/);
  });

  it("reads the stroke colour from --label-hatch, so a state can change it", () => {
    expect(body).toMatch(/background-image:\s*var\(--label-hatch\)/);
  });
});

// Every label role and call site, with the state rules that change its fill.
// A state that swaps the fill without the sprite is rule 2 of the hatch
// section: invisible in the light theme, a blank ring in the dark one.
describe.each([
  ["mem-seg-tabs (charts + discography tabs)", mixin(CANDY, "mem-seg-tabs")],
  ["btn-pill (search tabs, New Playlist, Save/Cancel …)", mixin(BUTTONS, "btn-pill")],
  ["btn-action with $hatch: label", mixin(BUTTONS, "btn-action")],
])("%s", (_name, body) => {
  it("carries the label hatch", () => {
    expect(body).toMatch(/@include mem-label-hatch\(/);
  });

  it("swaps the sprite on hover", () => {
    expect(body).toMatch(/--label-hatch:\s*var\(--mem-hatch-hover\)/);
  });
});

describe("the fills under the ring", () => {
  it("gives the tabs' active yellow the static ink sprite", () => {
    expect(block(mixin(CANDY, "mem-seg-tabs"), "&.active").body).toMatch(
      /--label-hatch:\s*var\(--mem-hatch-accent\)/
    );
  });

  it("treats the soft pill fill as theme-aware, not as an accent", () => {
    // `$mem-soft` goes dark with the theme; with the ink sprite on it the
    // search tabs' ring vanished in dark mode (measured).
    expect(mixin(BUTTONS, "btn-pill")).toMatch(/\$fill == \$mem-panel or \$fill == \$mem-soft, surface, accent/);
  });
});

// The call sites that used to opt OUT. A `$hatch: false` on btn-action is only
// right for a row in a list or menu (the content-list rule); none is left, so
// a new one has to be added here with its reason.
const ALLOWED_HATCH_FALSE: string[] = [];

const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

describe("label call sites", () => {
  it("found the component sources", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(100);
  });

  it("no btn-action opts out of the texture", () => {
    const offenders = Object.entries(SOURCES)
      .filter(([, src]) => /@include btn-action\([^)]*\$hatch:\s*false/.test(styleBlock(src)))
      .map(([path]) => path)
      .filter(path => !ALLOWED_HATCH_FALSE.includes(path));
    expect(offenders, "a label button went smooth again — use `$hatch: label`").toEqual([]);
  });

  it.each([
    "/src/components/CardListView/SortBanner.vue",
    "/src/components/Stats/ChartItemGroup.vue",
    "/src/components/PlaylistView/AfterHeader.vue",
    "/src/components/shared/DropDown.vue",
  ])("%s uses $hatch: label", path => {
    expect(styleBlock(SOURCES[path] ?? "")).toMatch(/@include btn-action\([^)]*\$hatch:\s*label/);
  });

  it("every settings segment carries it, not just the active one", () => {
    const select = styleBlock(SOURCES["/src/components/SettingsView/Components/Select.vue"] ?? "");
    const option = block(select, ".option").body;
    expect(option).toMatch(/@include mem-label-hatch\(/);
    expect(select).toMatch(/--label-hatch:\s*var\(--mem-hatch-accent\)/);
  });

  it("the section link (SEE ALL / VIEW HISTORY) carries the ring, and swaps it on hover", () => {
    // Reported on Home: it sat next to the smooth caption sticker and looked
    // like a second caption — the one place the texture has to tell them apart.
    const seeAll = block(styleBlock(SOURCES["/src/components/shared/SeeAll.vue"] ?? ""), ".see-all").body;
    expect(seeAll).toMatch(/@include mem-label-hatch\([^)]*\$on:\s*surface/);
    expect(block(seeAll, "&:hover").body).toMatch(/--label-hatch:\s*var\(--mem-hatch-hover\)/);
  });

  it("the genre chips on Home are pills, not a hand-drawn plate", () => {
    // Reported on "Never played": the chips had border and fill written by
    // hand and no shadow, next to caption plates that all cast one. They are
    // filter chips like the search tabs, so they take the same role, and the
    // pressed (yellow) one takes the static ink sprite.
    const home = styleBlock(SOURCES["/src/views/HomeView/main.vue"] ?? "");
    const chip = block(home, ".row-chip").body;
    expect(chip, ".row-chip block not found").not.toBe("");
    expect(chip).toMatch(/@include btn-pill\(/);
    expect(chip).not.toMatch(/^\s*border:/m);
    expect(block(chip, "&[aria-pressed='true']:hover").body).toMatch(/--label-hatch:\s*var\(--mem-hatch-accent\)/);
  });

  it("keeps the non-pressable sort labels smooth", () => {
    // "Sort By" and the chart glyph share the chips' anatomy but cannot be
    // pressed; a texture there would promise a press.
    const banner = styleBlock(SOURCES["/src/components/CardListView/SortBanner.vue"] ?? "");
    expect(block(block(banner, ".select.circular").body, "&::before").body).toMatch(/content:\s*none/);
  });
});
