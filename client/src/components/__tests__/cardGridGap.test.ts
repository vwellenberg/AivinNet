import { readFileSync, readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { CARD_GAP, CARD_MIN } from "@/utils/cardColumns";

// ---------------------------------------------------------------------------
// Every cover-card grid spaces its tiles with the SAME pair of tokens
// ($card-row-gap $card-col-gap, _variables.scss), and everything that
// partitions items into card rows counts columns with the gap included.
//
// This is a test because the miss was invisible from any single file: the
// Home rows got their gap with the plate anatomy (#196), while the album
// list, the search card pages and the discography kept their upstream
// gapless grids — the tiles carry no surface of their own, so the covers
// stood edge-to-edge and nobody's diff ever said so. A written-out `gap`
// is the same drift one rename away.
// ---------------------------------------------------------------------------

// The census marker: a grid that sizes its columns off the shared card width
// IS a card grid. Counting over the shared feature, not a hand-kept list —
// a new card grid joins this census by existing.
const GRID_MARKER = /repeat\(auto-fill,\s*minmax\(\$cardwidth/;
// The COLUMN gap must be the token — it is the half the JS column formula
// mirrors (CARD_GAP), so a literal here silently re-wraps rows. The row gap
// defaults to $card-row-gap but may be a page's own decision (the playlist
// grid breathes more), which changes nothing the JS needs to know.
const GAP_RULE = /gap:\s*(?:\$card-row-gap|[\d.]+rem)\s+\$card-col-gap/;

// Vue components come through Vite, so the glob sees exactly the files the
// build sees. Stylesheets cannot (`as: "raw"` on `.scss` returns an empty
// string under test — see .claude/rules/testing.md), so they are read off
// disk, relative to the runner's cwd (the project root).
const VUE_SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<
  string,
  string
>;

function scssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) files.push(...scssFiles(path));
    else if (entry.endsWith(".scss")) files.push(path);
  }
  return files;
}

/**
 * Comments go first: a token named in prose must neither satisfy the census
 * nor trip the maxAbumCards ban below (the very comments explaining the rule
 * name the banned identifier).
 */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

function cardGrids(): Map<string, string> {
  const grids = new Map<string, string>();

  for (const [file, source] of Object.entries(VUE_SOURCES)) {
    const bare = stripComments(source);
    if (GRID_MARKER.test(bare)) grids.set(file, bare);
  }

  for (const file of scssFiles("src/assets/scss")) {
    const bare = stripComments(readFileSync(file, "utf8"));
    if (GRID_MARKER.test(bare)) grids.set(file, bare);
  }

  return grids;
}

describe("card grid spacing", () => {
  const grids = cardGrids();

  it("finds the known card grids", () => {
    // Parser guard: if the marker regex stops matching the sources, the
    // census below would pass vacuously against an empty set.
    const files = [...grids.keys()];
    for (const known of [
      "/src/components/shared/CardScroller.vue",
      "/src/components/shared/CardRow.vue",
      "/src/views/ArtistDiscography.vue",
      "/src/views/PlaylistList.vue",
      "src/assets/scss/Global/basic.scss",
    ]) {
      expect(files, `census is missing ${known}`).toContain(known);
    }
  });

  it.each([...grids])("%s spaces its tiles with the shared gap tokens", (file, source) => {
    expect(
      GAP_RULE.test(source),
      `${file} builds a card grid (minmax($cardwidth…)) whose column gap is ` +
        "not `$card-col-gap` — its tiles stand edge-to-edge or drift from " +
        "the spacing every other card grid shares, and the JS column mirror " +
        "(utils/cardColumns.ts) no longer matches what CSS builds"
    ).toBe(true);
  });

  it("mirrors the SCSS tokens in cardColumns.ts", () => {
    // The JS column formula must move with the stylesheet: a gap or card
    // width changed on one side only silently re-wraps the one-row scrollers
    // and the virtualised row partitions.
    const variables = stripComments(readFileSync("src/assets/scss/_variables.scss", "utf8"));

    const gap = variables.match(/\$card-col-gap:\s*([\d.]+)rem/);
    expect(gap, "$card-col-gap is not defined in _variables.scss").toBeTruthy();
    expect(parseFloat((gap as RegExpMatchArray)[1]) * 16).toBe(CARD_GAP);

    const width = variables.match(/\$cardwidth:\s*([\d.]+)rem/);
    expect(width, "$cardwidth is not defined in _variables.scss").toBeTruthy();
    expect(parseFloat((width as RegExpMatchArray)[1]) * 16).toBe(CARD_MIN);
  });

  // The gapless twin of the CSS census: partitioning by `maxAbumCards` was
  // exactly right while the grids had no gap, and overshoots by one near the
  // breakpoints now that they do — the surplus card wraps into a ragged
  // second line inside its virtualised row.
  it.each([
    "/src/views/AlbumListView/main.vue",
    "/src/views/SearchView/CardGridPage.vue",
  ])("%s partitions rows by the measured column count", file => {
    expect(VUE_SOURCES[file], `${file} is gone — update this census`).toBeTruthy();
    const source = stripComments(VUE_SOURCES[file]);
    expect(source).toMatch(/useCardGridColumns/);
    expect(
      source.includes("maxAbumCards"),
      `${file} still reads maxAbumCards — that heuristic ignores the column ` +
        "gap; partition by useCardGridColumns instead"
    ).toBe(false);
  });
});
