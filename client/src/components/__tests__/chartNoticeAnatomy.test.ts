import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, ruleBodies, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The charts status slot — "Fetching data…" and "No album data found for this
// period".
//
// Reported as "das Anzeigefeld der Charts, Style prüfen". Three findings, and
// only the first one is visible in the light theme:
//
//   1. It was a flat blush bar across the full width: no ink frame, no offset
//      shadow. The one piece of text left on this screen without a plate after
//      #404 — every caption around it (the scrobble summary, the date under
//      the stat tiles, the page title) had already been given one.
//
//   2. The bar's fill was `$candy-pink-soft`, a THEME var, and the ink written
//      on it was STATIC. Measured in the running dark theme, #17171a on
//      #222226: 1.13:1. The sentence was invisible there, which is why the
//      report only describes the light theme.
//
//   3. The tabs above it sat 16px right of the page title and the chart rows,
//      the last of the leftovers #528, #550 and #555 worked through. That half
//      is policed by `leadingEdge.test.ts`, which owns the question for every
//      row on every page; `.chartnotice` and `.chartheader` are registered
//      there, not here.
//
// The static-ink question is asked of the WHOLE app, not just this file: the
// pairing was unique here when it was found (one sweep, one hit), and a census
// that only watches the file that already failed cannot say that again.
//
// ⚠️ A source-scanning test goes quietly green when its parser breaks (see
// .claude/rules/testing.md), so every expectation below is paired with a guard
// over its own input.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

const GROUP = "/src/components/Stats/ChartItemGroup.vue";

/**
 * Fills that FOLLOW THE THEME. Ink written on one of these is ink on a dark
 * indigo panel as soon as the user switches — the pairing that hid finding 2.
 */
const THEME_FILLS = ["$mem-soft", "$candy-pink-soft", "$mem-panel", "$candy-white", "var(--mem-soft)", "var(--mem-panel)"];

/**
 * Colours that do NOT follow the theme.
 *
 * ⚠️ `$candy-white` does not belong here however much the name suggests it:
 * _candy.scss aliases it to `$mem-panel`, i.e. `var(--mem-panel)`. Paper on a
 * theme fill is a legitimate pair — both halves flip together.
 */
const STATIC_INK = ["$mem-ink", "$candy-black", "$mem-paper"];

const declarationValues = (declarations: string, property: string) =>
  [...declarations.matchAll(new RegExp(`(?:^|[\\s;{])${property}:([^;}]+)`, "g"))].map(([, value]) =>
    value.trim().replace(/\s*!important$/, "")
  );

describe("charts status slot", () => {
  it("can read a declaration at all", () => {
    // ⚠️ The parser IS the test. `\s` inside a template literal is not an
    // escape — it collapses to a literal "s" — and the first version of this
    // file shipped exactly that: `declarationValues` matched nothing, and every
    // expectation below went green against the very bar it was written to
    // catch. Anything that reads source needs a fixture it must find.
    const sample = "{\n  background-color: $candy-pink-soft;\n  color: $candy-black;\n}";
    expect(declarationValues(sample, "background-color")).toEqual(["$candy-pink-soft"]);
    expect(declarationValues(sample, "color")).toEqual(["$candy-black"]);
    expect(declarationValues(sample, "height")).toEqual([]);
  });

  it("is one sticker, not a hand-rolled bar", () => {
    const source = SOURCES[GROUP];
    expect(source, `${GROUP} not found — did it move?`).toBeTruthy();

    const [notice] = blocks(styleBlock(source), ".chartnotice");
    expect(notice, "no `.chartnotice` block — the parser or the file changed").toBeTruthy();

    expect(notice, "the status slot is a caption sticker: plate, ink frame, offset shadow").toContain(
      "@include mem-sticker("
    );

    // `mem-sticker` owns all four; restating any of them here is the
    // hand-rolled bar coming back one declaration at a time.
    const own = ownDeclarations(notice);
    for (const property of ["border", "box-shadow", "background-color", "color"]) {
      expect(
        declarationValues(own, property),
        `${property} belongs to \`mem-sticker\` — it writes fill and ink as one pair`
      ).toEqual([]);
    }

    // A pinned height around a message that can wrap is a message that runs
    // out of its own frame ("No playlist data found for this period", phone).
    expect(declarationValues(own, "height"), "a sticker is as big as its words").toEqual([]);
  });

  it("promises nothing you can press", () => {
    const [notice] = blocks(styleBlock(SOURCES[GROUP]), ".chartnotice");
    expect(notice, "no `.chartnotice` block — the parser or the file changed").toBeTruthy();

    // A status line has no route and no handler. The hatch says "you can press
    // this" (styling.md, #378) and a hover says it too.
    expect(/mem-hatch/.test(notice), "the hatch means `you can press this`").toBe(false);
    expect(/:hover/.test(notice), "a status line is not a control — no hover state").toBe(false);
  });

  it("waits until it has something to say", () => {
    const source = SOURCES[GROUP];
    const [, condition] = /<div v-if="([^"]+)" class="chartnotice">/.exec(source) ?? [];
    expect(condition, "no `.chartnotice` element — the template changed").toBeTruthy();

    // Between resetting the list and the 450ms loader delay, both flags are
    // false: the old markup painted the plate anyway, so every period and
    // group switch flashed an EMPTY box. The plate belongs to the states, not
    // to the gap between them.
    expect(condition, "the plate renders only in a state that has text").toContain("loading");
    expect(condition, "the plate renders only in a state that has text").toContain("loaded");

    // The scrobble summary under the rows is the same rule: it was painted
    // from the first frame, so the whole loading window showed an empty
    // calendar chip and a bare arrow chip on the ground.
    expect(
      /<div v-if="scrobbleInfo" class="scrobbleinfo/.test(source),
      "the scrobble caption is a plate too — it waits for its own text"
    ).toBe(true);

    // ⚠️ And the fetcher has to clear it, or that `v-if` only ever suppresses
    // the FIRST load: every later switch would leave the previous period's
    // date range and trend arrow standing for the length of the request —
    // a wrong caption, which is worse than none.
    const [fetcher] = /async function getItems\(\)[\s\S]*?\n\}/.exec(source) ?? [];
    expect(fetcher, "getItems() not found — did it move?").toBeTruthy();
    expect(fetcher, "the fetcher body was cut short — check the parser").toContain("fetchSeq");
    expect(fetcher, "a new period clears the old caption").toContain("scrobbleInfo.value = null");
  });

  it("never writes static ink on a theme-following fill, anywhere", () => {
    const entries = Object.entries(SOURCES);
    expect(entries.length, "the source glob found nothing").toBeGreaterThan(100);

    const offenders: string[] = [];
    for (const [path, source] of entries) {
      const css = styleBlock(source);
      // Every rule body at every depth, not a list of selectors: the pairing
      // is a property of a block, and the block that had it was named
      // `.noitems` — nothing a selector list would have thought to include.
      // `ruleBodies` strips each block's children, so a fill declared by a
      // parent and an ink declared by a child stay separate facts.
      for (const body of ruleBodies(css)) {
        const fills = declarationValues(body, "background-color").concat(declarationValues(body, "background"));
        const inks = declarationValues(body, "color");
        const themeFill = fills.find(fill => THEME_FILLS.includes(fill));
        const staticInk = inks.find(ink => STATIC_INK.includes(ink));
        if (themeFill && staticInk) {
          offenders.push(`${path}: color ${staticInk} on ${themeFill}`);
        }
      }
    }

    expect(offenders, "a theme-following fill turns dark; the ink on it has to turn with it").toEqual([]);
  });
});
