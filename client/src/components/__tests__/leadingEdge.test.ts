import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, shorthandLeft, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// One leading edge per page.
//
// A section caption, the cards or rows under it and the page head all start on
// the SAME line (styling.md, "Der Sticker fluchtet links"). Drift off it is
// invisible in isolation — each element looks fine in its own file and its own
// screenshot — and only shows next to the neighbour that does it right. Every
// instance so far was reported from a user screenshot, never by a test:
//
//   #528  the sort banner's chip row      12px in (chips 315, cards 303)
//   #550  the genre banner                12px in, and the stat tiles under it
//         (16px on /stats, which reads the component's own padding while the
//         two detail pages override it)
//   here  the chart group's three non-row children: the scrobble caption
//         (322.2/1373.8), the pager (319/1377) and the empty-state plate,
//         against chart rows spanning 303/1393
//
// `sectionCaptionSticker` polices this for HEADINGS. These are the rows that
// are not headings and therefore answer to nobody — until here.
//
// The hosts are SWEPT, not listed: an inset on these rows does not have to live
// in the row's own file, and twice it did not (two page stylesheets carried the
// stat tiles' one). A third page adding one is exactly how the last of these
// survived a round of fixes.
//
// Scope note: LEFT only. The right edge is a real half of the rule for a
// `space-between` row — the chart caption's trend sticker has to end where the
// rows end — but several of these rows keep a deliberate `padding-right` as
// shadow reserve for horizontal scrolling (`.statshead`, the genre banner's
// scroller). Sweeping the right side would have to carry that exception list;
// the left side carries none.
//
// ⚠️ A source-scanning test goes quietly green when its parser breaks (see
// .claude/rules/testing.md), so every expectation below is paired with a guard
// over its own input.
// ---------------------------------------------------------------------------
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

/** The rows that carry the page's leading edge, and the hosts we know reach them. */
const ROWS = [
  ".genres-banner",
  ".statshead",
  ".statsdates",
  ".scrobbleinfo",
  ".chartpager",
  ".chartnotice",
  // The tabs above the rows are the same row one level up — a plate with its
  // own padding, sitting 16px inside the page title and the chart rows.
  ".chartheader",
];
const KNOWN_HOSTS = [
  "/src/components/AlbumView/GenreBanner.vue",
  "/src/components/Stats/ChartItemGroup.vue",
  "/src/components/Stats/ChartsHeader.vue",
  "/src/components/Stats/Stats.vue",
  "/src/views/AlbumView/index.vue",
  "/src/views/ArtistView/Main.vue",
];

/**
 * Does this row paint its own surface?
 *
 * The distinction decides whether its `padding` counts. A BARE container has
 * no edge of its own, so padding is the thing that pushes its children off the
 * page's line — that is precisely what the genre banner and the stat rows did.
 * A PLATE's padding sits inside its own frame: the plate's edge is what lines
 * up, and taking the padding away would press the text against the border. The
 * empty-state plate on the charts screen is the second kind, and reading its
 * `padding: 1rem` as an inset was this census's first false positive.
 *
 * Either way the MARGIN always counts — that moves the box itself.
 */
function paintsItsOwnSurface(declarations: string): boolean {
  // The VALUE decides, not the presence of the declaration. `background:
  // transparent` paints nothing — reading it as a plate would hand any row an
  // opt-out of the padding check, which is the #550 regression with a one-line
  // key. `background-image` counts: a hatch or a gradient is a surface too.
  const painted = [...declarations.matchAll(/(?:^|[\s;{])background(?:-color|-image)?:([^;}]+)/g)].some(
    ([, value]) => !/^\s*(transparent|none|inherit|initial|unset)\s*$/.test(value)
  );
  return painted || /@include\s+(?:mem-sticker|candy-box)/.test(declarations);
}

/** Every left inset a block declares, through the shorthand or on its own. */
function leftInsets(declarations: string): string[] {
  const out: string[] = [];
  const properties = paintsItsOwnSurface(declarations) ? ["margin"] : ["padding", "margin"];
  for (const property of properties) {
    for (const [, value] of declarations.matchAll(new RegExp(`(?:^|[\\s;{])${property}:([^;}]+)`, "g"))) {
      const left = shorthandLeft(value);
      if (left) out.push(left);
    }
    for (const [, value] of declarations.matchAll(new RegExp(`(?:^|[\\s;{])${property}-left:([^;}]+)`, "g"))) {
      out.push(value.trim());
    }
  }
  return out;
}

const isZero = (value: string) => /^0[a-z%]*$/.test(value);


describe("leading edge", () => {
  it("holds for every row, in every host that reaches one", () => {
    const hosts = Object.entries(SOURCES).filter(([, source]) =>
      ROWS.some(row => blocks(styleBlock(source), row).length > 0)
    );
    // Guard over the sweep: the five files we know about have to be in it, or
    // the selector match silently stopped working.
    for (const known of KNOWN_HOSTS) {
      expect(
        hosts.some(([path]) => path === known),
        `${known} no longer matches the sweep — did the class names change?`
      ).toBe(true);
    }

    // ⚠️ And every ROW has to be found somewhere. The host guard above does NOT
    // cover this: ChartItemGroup.vue keeps matching through `.scrobbleinfo`, so
    // renaming a row would drop it out of the census with all the files still
    // present and the test still green — a census quietly policing one row less
    // than it claims. It earned its keep immediately: `.noitems` became
    // `.chartnotice` in the very next change to that file.
    for (const row of ROWS) {
      expect(
        hosts.some(([, source]) => blocks(styleBlock(source), row).length > 0),
        `no host declares ${row} any more — did it move, or was it renamed?`
      ).toBe(true);
    }

    for (const [path, source] of hosts) {
      const css = styleBlock(source);
      for (const row of ROWS) {
        for (const body of blocks(css, row)) {
          for (const left of leftInsets(ownDeclarations(body))) {
            expect(
              isZero(left),
              `${path} insets ${row} by ${left} — these rows start on the page's leading edge`
            ).toBe(true);
          }
        }
      }
    }
  });
});
