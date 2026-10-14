import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// EVERY DESKTOP PAGE STARTS AT THE SAME LINE.
//
// The phone has had one start for every page since $phone-page-start
// (phonePageStart.test.ts). The desktop had seven: measured at 1440 against the
// content panel's inner edge, the detail pages and Now Playing started at 32px,
// a page title at 52, Home at 68, Albums/Artists/Favorites at 84, Stats at 92,
// a search at 16, the idle search at 0 and Folders at 8. Reported as "the
// content starts at a different height on every screen".
//
// The cause was one shape in five places: the alt layout's page container
// already gives every page 2rem, and the empty page head (36px of padding),
// the sort chips (1rem), Favorites' first row (1rem) and the chart grid
// (1.25rem + 4px) each added their own on top — while the search page and the
// folder view, which manage their own scrollers, had none.
//
// jsdom applies no stylesheet, so the census reads the source: one token, the
// container that gives it, and every first element that must not add to it.
// Measured after the change: 32px on all 18 main routes (PR).
// ---------------------------------------------------------------------------

const read = (rel: string) => readFileSync(join("src", rel), "utf-8");

/** The body of every `@include <mixin> { … }` in `source`, braces balanced. */
function includeBlocks(source: string, mixin: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const start = source.indexOf(`@include ${mixin} {`, from);
    if (start === -1) return out;
    let depth = 0;
    for (let i = source.indexOf("{", start); i < source.length; i++) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}" && --depth === 0) {
        out.push(source.slice(start, i + 1));
        from = i + 1;
        break;
      }
    }
  }
}

/** The style of `selector` from its opening brace to the next sibling rule. */
function styleOf(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  expect(start, `no rule for ${selector}`).toBeGreaterThan(-1);
  return source.slice(start);
}

describe("desktop page start", () => {
  it("is one token, and the alt layout's container gives it", () => {
    expect(read("assets/scss/_variables.scss")).toMatch(/^\$page-start: 2rem;/m);
    const grid = read("assets/scss/Global/app-grid.scss");
    expect(grid).toMatch(/\.vue-recycle-scroller,\s*\.content-page \{\s*padding-top: \$page-start;/);
    expect(grid).not.toMatch(/\.content-page \{\s*padding-top: 2rem;/);
  });

  it("reads the alt layout through its class", () => {
    expect(read("assets/scss/_mixins.scss")).toMatch(/@mixin altLayout \{\s*#app-grid\.is_alt_layout & \{\s*@content;/);
  });

  it("is not topped up by the page head, and an empty head takes no room", () => {
    const head = read("components/shared/GenericHeader.vue");
    const blocks = includeBlocks(head, "altLayout");
    expect(blocks.length).toBe(1);
    // Only the head that starts the page: /stats has a second one as a section
    // heading under the charts.
    expect(blocks[0]).toMatch(/&:first-child \{\s*padding-top: 0;/);
    expect(blocks[0]).toMatch(/&\.is-empty \{\s*padding-bottom: 0;/);
    // "Empty" is what the head PAINTS: the description slot never is.
    expect(head).toContain(":class=\"{ 'is-empty': !painted }\"");
    expect(head).toMatch(/painted = computed\(\(\) => Boolean\(slots\.name \|\| slots\.right \|\| slots\.after\)\)/);
  });

  it.each([
    ["components/CardListView/SortBanner.vue", ".itemsortby", "padding-top"],
    ["views/Favorites.vue", ".recent-favs", "padding-top"],
    ["components/Stats/Charts.vue", ".chartitemgroupsgrid", "margin-top"],
    ["components/Stats/ChartsHeader.vue", ".chartheader", "padding-top"],
  ])("is not topped up by the first element of %s", (file, selector, property) => {
    const source = read(file);
    const blocks = includeBlocks(styleOf(source, selector), "altLayout");
    expect(blocks.length, `${selector} has no altLayout block`).toBeGreaterThan(0);
    expect(blocks[0]).toMatch(new RegExp(`^\\s*${property}: 0;`, "m"));
  });

  it("drops the empty head from the album list on the desktop, where a 0px scroller item counts as 64px", () => {
    const view = read("views/AlbumListView/main.vue");
    expect(view).toMatch(/if \(!settings\.is_alt_layout\) \{\s*items\.push\(\{\s*id: "header",\s*component: GenericHeader,/);
  });

  it("is given by the search page and the folder view, which own their scrollers", () => {
    const search = read("views/SearchView/main.vue");
    const blocks = includeBlocks(search, "altLayout");
    expect(blocks.length).toBe(2);
    for (const block of blocks) expect(block).toMatch(/padding-top: \$page-start;/);
    expect(search).toMatch(/&:not\(\.has_query\) \.search-page-top-results \{\s*@include altLayout/);

    // The folder head keeps its own $small (it travels with the plate when it
    // sticks); the container in front of the scroller gives the rest.
    const folder = read("views/FolderView.vue");
    expect(folder).toMatch(/\.folder-view\.is_alt_layout \{\s*padding-top: calc\(#\{\$page-start\} - #\{\$small\}\);/);
    expect(folder).toMatch(/#folder-nav-title \{[^}]*margin: \$small 0;/);
  });
});
