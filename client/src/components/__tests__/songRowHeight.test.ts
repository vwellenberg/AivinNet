import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SONG_ROW_HEIGHT } from "@/utils/songItemMethods";

// ---------------------------------------------------------------------------
// A fixed-size scroller pitches its rows at exactly `item-size`. It does not
// measure, and nothing complains when the number is wrong: the item wrapper is
// `overflow: visible` (app-grid.scss), so a row taller than the pitch simply
// draws over the one above it. What disappears under that overlap is the
// BOTTOM of the previous row — which is where the inlay's perforation lives.
//
// Three lists shipped a hand-written `64` against a 72px row. Measured on the
// running app, every separator on the artist "show all tracks" page and the
// search Tracks tab came out rgb(226,224,220) instead of the ink rgb(23,23,26)
// the album view (a measuring DynamicScroller) painted: 8% of the dashes
// showing through the next row's 92%-opaque veil plate. No test, no lint and no
// screenshot of a single file could say so — the number was right next to a
// scroller that behaved, and the row height lived in a stylesheet.
//
// So both halves are pinned here: the constant against the SCSS token, and
// every fixed-size track scroller against the constant.
// ---------------------------------------------------------------------------

const VUE_SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<
  string,
  string
>;

/** Comments name the very literals this census bans — strip them first. */
function stripComments(source: string): string {
  return source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

describe("the track row height has one source", () => {
  it("mirrors $song-item-height from the stylesheet", () => {
    const scss = readFileSync("src/assets/scss/_variables.scss", "utf-8");
    const match = scss.match(/\$song-item-height:\s*([\d.]+)rem/);

    expect(match, "$song-item-height must stay a rem value in _variables.scss").toBeTruthy();
    expect(Number(match![1]) * 16).toBe(SONG_ROW_HEIGHT);
  });

  // The census marker is the SHARED FEATURE, not a hand-kept file list: a
  // fixed-size scroller that stacks track rows joins this census by existing.
  // A list of three would have been exactly as green before the bug as after.
  it("is what every fixed-size track scroller pitches its rows at", () => {
    const offenders: string[] = [];
    const audited: string[] = [];

    for (const [path, raw] of Object.entries(VUE_SOURCES)) {
      const source = stripComments(raw);
      if (!source.includes("<RecycleScroller")) continue;
      if (!/SongItem/.test(source)) continue;

      audited.push(path);

      // A file may hold more than one scroller — audit EVERY binding in it,
      // not just the first. Reading `match` alone would grade a second,
      // unrelated scroller's number as if it were the track list's.
      const bindings = [...source.matchAll(/:item-size="([^"]+)"/g)];
      if (!bindings.length) {
        offenders.push(`${path}: no :item-size binding`);
        continue;
      }

      // Locals collected with matchAll rather than a per-name regex built from
      // a template literal: `\s` inside one is just `s`, and the census would
      // have gone quietly green on every file it was meant to catch.
      const locals = new Map<string, string>();
      for (const decl of source.matchAll(
        /const\s+([A-Za-z_$][\w$]*)\s*(?::\s*number\s*)?=\s*([^\n;]+)/g
      )) {
        locals.set(decl[1], decl[2].trim());
      }

      // ⚠️ The name is not the value. A file that declares its OWN
      // `const SONG_ROW_HEIGHT = 64` reads exactly like a compliant one — the
      // same shape as "the import is there, so the rule must hold". The
      // identifier only counts when it comes from the shared module.
      const importsConstant =
        /import\s*\{[^}]*\bSONG_ROW_HEIGHT\b[^}]*\}\s*from\s*["']@\/utils\/songItemMethods["']/.test(
          source
        );

      for (const binding of bindings) {
        const expression = binding[1].trim();
        const resolved = expression === "SONG_ROW_HEIGHT" ? expression : locals.get(expression);

        if (resolved === "SONG_ROW_HEIGHT" && importsConstant && !locals.has("SONG_ROW_HEIGHT")) {
          continue;
        }

        offenders.push(
          `${path}: :item-size="${expression}"` +
            (resolved && resolved !== expression ? ` (= ${resolved})` : "") +
            (importsConstant ? "" : " — SONG_ROW_HEIGHT not imported from @/utils/songItemMethods")
        );
      }
    }

    // ⚠️ A census that examined nothing reads exactly like a clean one. If the
    // marker stops matching (a kebab-cased tag, a moved glob), this is the only
    // line that says so — without it both lists could regress to a literal and
    // the suite would stay green. The floor tracks the real population (two:
    // ArtistTracks and the search Tracks tab) rather than a number of its own,
    // because a list may legitimately leave the census — the orphaned
    // SongList.vue did.
    expect(
      audited.length,
      `the RecycleScroller/SongItem census matched ${audited.length} file(s): ${audited.join(", ") || "none"}`
    ).toBeGreaterThan(1);
    expect(offenders, "fixed-size track scrollers must pitch rows at SONG_ROW_HEIGHT").toEqual([]);
  });
});
