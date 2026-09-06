import { readFileSync, readdirSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The charts block on a 320px phone. Two halves, one report: the block ran off
// the screen, and the rows inside it did not fit either.
//
// PART ONE — a segmented tab plate cannot shrink, so the box around it has to
// scroll.
//
// The plate's width IS its words: four labels, `white-space: nowrap`, and a
// wrapped segment would break the plate's row of dividers. On a phone that is
// 312px of min-content. The charts header had no scroller, and because
// `.chartitemgroupsgrid` used a bare `1fr` — whose automatic minimum is
// MIN-CONTENT — the group grew to the plate's size and dragged the whole page
// with it: measured at 320px, a 308px group in a 258px track, with the tabs,
// the stat tile and both captions cut off at the screen edge (#558).
//
// The discography page had solved this a release earlier with an outer
// scrolling div. Two tab groups needing the same box is exactly the drift
// `mem-seg-tabs` was extracted to stop (#499, #456), so the scroller is a
// mixin now and this census asks the question of every host there is.
//
// ⚠️ A source-scanning test goes quietly green when its parser breaks (see
// .claude/rules/testing.md), so every expectation below is paired with a guard
// over its own input.
//
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;
// ⚠️ Read from disk, not through `import.meta.glob`: Vite runs stylesheets
// through the CSS pipeline, which is stubbed under test, and hands back an
// EMPTY STRING for .scss — every assertion below would pass on nothing.
const CANDY_FILE = "src/assets/scss/_candy.scss";

const HEADER = "/src/components/Stats/ChartsHeader.vue";
const CHARTS = "/src/components/Stats/Charts.vue";
const TABS = "/src/components/shared/GenericTabs.vue";

/** Every component that mounts a segmented tab plate. */
function segHosts(): [string, string][] {
  return Object.entries(SOURCES).filter(([, source]) => /@include\s+mem-seg-tabs/.test(styleBlock(source)));
}

// PART TWO — the row's own five columns. Once the group stopped stretching,
// the 258px track had to hold what a 308px one used to: the fixed part alone
// (24 + 46 + 46 plus four 24px gaps) was 212px, and the title and the duration
// overlapped in the remaining 46. Both halves are below, in that order.
// ---------------------------------------------------------------------------

/**
 * A mixin's body, looked up by NAME.
 *
 * `blocks()` wants its selector followed by `{`, which stopped matching the
 * moment this mixin took a parameter — and the failure read as "the mixin is
 * gone", which it was not. The parameter list is exactly what this census is
 * about now, so the lookup has to survive it.
 */
function mixinBody(css: string, name: string): string {
  const at = css.indexOf(`@mixin ${name}`);
  if (at < 0) return "";
  const open = css.indexOf("{", at);
  if (open < 0) return "";

  let depth = 1;
  let i = open + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  // Keep the signature: the parameter is part of what is asserted.
  return css.slice(at, i);
}

/**
 * Every global stylesheet, read from DISK.
 *
 * ⚠️ `import.meta.glob(..., { as: "raw" })` hands back an EMPTY STRING for
 * .scss — Vite runs stylesheets through the CSS pipeline, which is stubbed
 * under test. A census that sweeps only `.vue` therefore cannot see
 * `Global/search-tabheaders.scss`, where half of the search chip row lives:
 * re-adding the width cap there would restore the regression with every
 * assertion still green.
 */
function globalSheets(): [string, string][] {
  const dir = "src/assets/scss";
  const out: [string, string][] = [];

  const walk = (at: string) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = `${at}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".scss")) out.push([path, readFileSync(path, "utf8")]);
    }
  };
  walk(dir);
  return out;
}

describe("segmented tabs scroll instead of stretching the page", () => {
  it("keeps the scroller in one mixin", () => {
    const candy = readFileSync(CANDY_FILE, "utf8");
    expect(candy.length, `${CANDY_FILE} read empty — did it move?`).toBeGreaterThan(1000);

    const scroll = mixinBody(candy, "mem-seg-scroll");
    expect(scroll, "no `mem-seg-scroll` mixin — the parser or the file changed").toBeTruthy();

    // The four declarations that make it work, each for its own reason:
    // scroll on one axis, do not become a vertical clipper, be allowed to
    // shrink as a flex item, and leave room for the plate's offset shadow —
    // a box-shadow is overflow, not layout, so the scroll port cuts it.
    expect(scroll, "the scroller scrolls sideways").toMatch(/overflow-x:\s*auto/);
    expect(scroll, "the other axis must be stated, or it computes to auto").toMatch(/overflow-y:\s*hidden/);
    expect(scroll, "a flex item does not shrink below min-content on its own").toMatch(/min-width:\s*0/);
    // The reserve is a PARAMETER, not a literal: the search chips overhang by
    // 8px (their 1.04 hover scale on top of the 4px offset), and hard-coding
    // 4px is what kept that row on its own hand-rolled copy.
    expect(scroll, "the offset shadow needs room inside the scroll port").toMatch(
      /padding-(?:bottom|right):\s*\$reserve/
    );
    expect(scroll, "and callers that overhang further need a knob for it").toMatch(
      /@mixin mem-seg-scroll\(\$reserve:/
    );
  });

  it("has no fourth hand-rolled copy of that box", () => {
    // A LIST, not a sweep — and the difference is the point. Plenty of rows
    // scroll sideways (`.statshead`, the genre chips): they scroll CARDS in a
    // box that is nothing but a viewport. These three scroll a row of objects
    // that each cast an offset shadow, which is what makes the reserve — and
    // therefore this mixin — the right box for them. Adding a card scroller
    // here would be as wrong as leaving one of these out.
    //
    // Every entry has to be FOUND, or a rename drops it and the census goes
    // quiet while still reporting three.
    const SCROLLERS = [".generictabs-scroll", ".seg-scroll", ".tabheaders"];

    for (const selector of SCROLLERS) {
      const hosts = Object.entries(SOURCES).filter(([, source]) => {
        const own = blocks(styleBlock(source), selector);
        return own.some(body => /@include\s+mem-seg-scroll/.test(body));
      });
      // ⚠️ And the STYLESHEETS, not only the components. `.tabheaders` has a
      // second block in `Global/search-tabheaders.scss` — re-adding the width
      // cap or the overflow there restores the exact regression this census
      // was written for, in a file `import.meta.glob` cannot even read (Vite
      // hands back an empty string for .scss under test).
      const sheetBlocks: [string, string][] = [];
      for (const [path, sheet] of globalSheets()) {
        for (const body of blocks(sheet, selector)) sheetBlocks.push([path, body]);
      }
      expect(
        hosts.length,
        `no component builds ${selector} from mem-seg-scroll any more — renamed, or hand-rolled again?`
      ).toBeGreaterThan(0);

      const everyBlock: [string, string][] = [
        ...hosts.flatMap(([path, source]) =>
          blocks(styleBlock(source), selector).map(body => [path, body] as [string, string])
        ),
        ...sheetBlocks,
      ];

      for (const [path, body] of everyBlock) {
        const own = ownDeclarations(body);
        // What the mixin owns. `max-width` is on the list because the copy
        // this replaced wrote its reserve as `calc(100% - 16px)` — a width
        // cap, which puts the room OUTSIDE the scroll port, i.e. exactly
        // where the shadow at the end of the scroll cannot reach it.
        //
        // LONGHANDS INCLUDED: the reserve is a PARAMETER now, so restating it
        // as `padding-bottom` is the natural way to drift back, and a list of
        // shorthands alone would wave that through. Written as a literal
        // regex rather than built from a property list — `\s` inside a
        // template literal is not an escape, and this file has shipped that
        // bug twice (see the fixture in `can read a declaration at all`).
        const OWNED =
          /(?:^|[\s;{])(?:overflow(?:-[xy])?|max-width|padding(?:-(?:top|right|bottom|left))?)\s*:/;
        expect(
          OWNED.exec(own)?.[0].trim(),
          `${path} restates a scroll-box property on ${selector} — that belongs to mem-seg-scroll`
        ).toBeUndefined();
      }
    }
  });

  it("gives every tab plate a scroller, and none of them a hand-rolled one", () => {
    const hosts = segHosts();
    // Guard over the sweep: the two hosts we know about have to be in it.
    for (const known of [HEADER, TABS]) {
      expect(
        hosts.some(([path]) => path === known),
        `${known} no longer includes mem-seg-tabs — did the class names change?`
      ).toBe(true);
    }

    for (const [path, source] of hosts) {
      const css = styleBlock(source);
      expect(
        /@include\s+mem-seg-scroll/.test(css),
        `${path} mounts a tab plate with nothing to scroll it — see mem-seg-scroll`
      ).toBe(true);
      // The mixin owns the anatomy. A host writing its own `overflow-x` is the
      // copy this census exists to prevent: the discography page carried one
      // for a release while the charts header had none.
      expect(
        /overflow-x:/.test(css),
        `${path} hand-rolls the scroller — the anatomy belongs to mem-seg-scroll`
      ).toBe(false);
    }
  });

  it("wraps each plate in its own scroller", () => {
    const source = SOURCES[HEADER];
    expect(source, `${HEADER} not found — did it move?`).toBeTruthy();

    // One scroller per plate, not one around both: the two groups sit at
    // opposite ends of a `space-between` row, and a single scroll port would
    // hide the period tabs behind a scroll instead of letting them wrap.
    const scrollers = source.match(/<div class="seg-scroll">/g) ?? [];
    const plates = source.match(/class="seg"/g) ?? [];
    expect(plates.length, "no `.seg` plates — the template changed").toBe(2);
    expect(scrollers.length, "each plate scrolls in its own box").toBe(plates.length);
  });

  it("lets the grid track decide the width, not the widest child", () => {
    const css = styleBlock(SOURCES[CHARTS]);
    const [grid] = blocks(css, ".chartitemgroupsgrid");
    expect(grid, "no `.chartitemgroupsgrid` block — the parser or the file changed").toBeTruthy();

    const [, track] = /grid-template-columns:([^;}]+)/.exec(ownDeclarations(grid)) ?? [];
    expect(track, "the grid declares no columns any more").toBeTruthy();
    // ⚠️ `1fr` is not `minmax(0, 1fr)`. A grid item's automatic minimum is its
    // min-content, so a bare `1fr` track cannot be narrower than the widest
    // thing inside it — which is how a tab plate resized the page.
    expect(track.trim(), "a bare `1fr` track is as wide as its widest child").toContain("minmax(0");
  });

  it("is watched by the deploy gate that missed it", () => {
    const gate = readFileSync("scripts/overflow-check.js", "utf8");
    expect(gate.length, "scripts/overflow-check.js read empty — did it move?").toBeGreaterThan(500);

    // The route was never visited, so nothing looked.
    expect(gate, "/stats is where this was found; the gate has to visit it").toMatch(/ROUTES[\s\S]{0,200}\/stats/);
    // And visiting it would not have been enough: the route scrolls in its own
    // box, so the overflow never reached the document and every width reported
    // OK. The gate measures those boxes now.
    //
    // ⚠️ The LIST, not the word. `content-page` also appears in the comment
    // that explains it, so a check for the bare string stays green while the
    // selector is changed out from under it — measured.
    const [, boxes] = /PAGE_BOXES\s*=\s*\[([^\]]*)\]/.exec(gate) ?? [];
    expect(boxes, "the gate declares no page boxes any more").toBeTruthy();
    for (const box of [".content-page", ".search-page-top-results"]) {
      expect(boxes, `${box} holds a whole route — the gate has to measure it`).toContain(box);
    }
    // A selector that matches nothing checks nothing, so the gate has to say
    // so instead of passing quietly.
    expect(gate, "an unmatched page box must fail the harness, not the run").toMatch(/seenBoxes/);
    expect(gate, "and the result has to decide the exit code").toMatch(/pages\.length === 0/);
  });
});

describe("the chart row fits a phone", () => {
  const ROW = "/src/components/Stats/ChartItem.vue";

  it("lets a long title break instead of widening the row", () => {
    const css = styleBlock(SOURCES[ROW]);
    expect(css.length, `${ROW} has no style block — did it move?`).toBeGreaterThan(100);

    const [info] = blocks(css, ".iteminfo");
    expect(info, "no `.iteminfo` block — the parser or the file changed").toBeTruthy();
    // Its grid column is `1fr`, whose automatic minimum is min-content.
    expect(ownDeclarations(info), "the info column has to be allowed to shrink").toMatch(/min-width:\s*0/);

    const [title] = blocks(info, ".title");
    expect(title, "no `.title` block — the parser or the file changed").toBeTruthy();
    // ⚠️ `anywhere`, not `break-word`: only `anywhere` lowers MIN-CONTENT,
    // which is the number the grid track reads. And not an ellipsis — clamped
    // to one line in a 320px column the title renders as nothing (measured).
    expect(title, "a long word must break, or it sets the row's width").toMatch(
      /overflow-wrap:\s*anywhere/
    );
    expect(/text-overflow:/.test(title), "an ellipsis here empties the title on a phone").toBe(false);
  });

  it("drops the duration under the row instead of out of it", () => {
    const css = styleBlock(SOURCES[ROW]);
    const [row] = blocks(css, ".chartitem");
    expect(row, "no `.chartitem` block — the parser or the file changed").toBeTruthy();

    const [phones] = blocks(row, "@include smallerPhones");
    expect(phones, "the row has no phone layout — five columns do not fit 320px").toBeTruthy();

    // Four columns, not five: the fixed part of the five-column track plus its
    // gaps was 212px of a 258px row, and the title and the duration overlapped
    // in what was left.
    expect(phones, "the phone layout drops a column").toMatch(/grid-template-columns:[^;]*1fr\s*;/);
    const [help] = blocks(phones, ".helptext");
    expect(help, "the duration has to land somewhere — hiding it is not it").toBeTruthy();
    expect(help, "under the info block, second row").toMatch(/grid-row:\s*2/);
  });
});
