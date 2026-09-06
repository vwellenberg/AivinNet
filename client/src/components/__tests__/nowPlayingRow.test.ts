import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The "this row is playing" state is ONE decision: `mem-now-playing-row` in
// src/assets/scss/_candy.scss (yellow fill + ink frame + the zigzag marker on
// the leading edge).
//
// This is a test rather than a comment because the state was written out twice
// — once in SongItem.vue for song lists, once in TrackItem.vue for the queue —
// and the two copies were word-for-word identical, so every change to the
// ornament had to be made in both and nothing said so. The second copy is easy
// to miss: the queue row only shows up in the right sidebar, and only while
// something is playing.
//
// The colour half matters just as much. On `$mem-yellow` teal measures 1.24:1
// and coral 1.98:1 against WCAG 1.4.11's 3:1 — the marker has to stay ink, and
// its ink is baked into the asset so no host `color` can take it away
// (.claude/rules/styling.md).
// ---------------------------------------------------------------------------

// `.vue` through Vite (the test then sees what the build sees), `.scss` through
// `fs` — a raw glob returns an EMPTY string for stylesheets, which makes a
// source-scanning test silently green (.claude/rules/testing.md).
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;
const CANDY_FILE = "src/assets/scss/_candy.scss";
const MIXIN = "mem-now-playing-row";

/**
 * Every row that marks the currently-playing track, with the selector that
 * owns it.
 *
 * One entry since #416 — `TrackItem.vue` was the second, and it is gone along
 * with the queue panel it belonged to. The rule it existed to enforce stands:
 * a row that marks the playing state reads the mixin, it never writes the
 * ornament out. A future second row gets added HERE.
 */
const ROWS = [{ file: "/src/components/shared/SongItem.vue", selector: ".songlist-item.current" }];

/** The `<style>` blocks of an SFC, with comments removed. */
function styleSource(source: string): string {
  const styles = source.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  return styles
    .join("\n")
    .replace(/<\/?style[^>]*>/gi, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // `[^:]` guards `https://` — a line comment never follows a colon here.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The body of the rule/mixin whose head matches `head`, braces balanced.
 *
 * The optional `(…)` is not decoration: a mixin declares its parameters between
 * the name and the brace (`@mixin mem-now-playing-row($radius: …) {`), and
 * without it this returned null for every mixin that takes one — which reads
 * exactly like "the mixin is missing".
 */
function blockFor(source: string, head: string): string | null {
  const opener = new RegExp(`${head.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(\\([^)]*\\))?\\s*\\{`);
  const match = opener.exec(source);
  if (!match) return null;

  const firstBrace = match.index + match[0].length - 1;
  let depth = 0;
  for (let i = firstBrace; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(firstBrace + 1, i);
  }
  return null;
}

describe("now-playing row", () => {
  // A source-scanning test goes silently green when its parser breaks, so it
  // guards its own inputs first.
  it("reads the sources it claims to check", () => {
    expect(Object.keys(SOURCES).length).toBeGreaterThan(50);

    for (const row of ROWS) {
      expect(SOURCES[row.file], `${row.file} not found`).toBeTruthy();
      expect(blockFor(styleSource(SOURCES[row.file]), row.selector), `${row.selector} not parsed`).toBeTruthy();
    }

    // The parser has to be able to MISS, too — otherwise every check below
    // passes on an empty string.
    expect(blockFor(styleSource(SOURCES[ROWS[0].file]), ".songlist-item-does-not-exist")).toBeNull();

    // And it has to survive a mixin's parameter list, which is what the first
    // version of this file got wrong: `@mixin candy-box($bg: …, $radius: …)`
    // came back null, indistinguishable from "the mixin is gone".
    const candy = readFileSync(CANDY_FILE, "utf-8");
    expect(candy.length).toBeGreaterThan(1000);
    expect(blockFor(candy, "@mixin candy-box"), "parser trips over mixin parameters").toBeTruthy();
  });

  it.each(ROWS)("$selector takes the shared mixin instead of its own fill", ({ file, selector }) => {
    const block = blockFor(styleSource(SOURCES[file]), selector) ?? "";

    expect(block).toContain(`@include ${MIXIN}`);
    // Hand-written fill/frame is exactly the drift this replaces.
    expect(block).not.toContain("$mem-yellow");
    expect(block).not.toMatch(/border-radius:\s*\$candy-radius-sm/);
  });

  it("marks the leading edge in ink, never in an accent", () => {
    const candy = readFileSync(CANDY_FILE, "utf-8");
    const mixin = blockFor(candy, `@mixin ${MIXIN}`);

    expect(mixin, `@mixin ${MIXIN} not found in ${CANDY_FILE}`).toBeTruthy();
    // Ink (9.64:1 on yellow), baked into the asset — not $mem-teal (1.24:1)
    // and not $mem-coral (1.98:1).
    expect(mixin).toContain("%2317171A");
    expect(mixin).not.toContain("$mem-teal");
    expect(mixin).not.toContain("$mem-coral");
    // Leading edge, not the bottom one: the old strip ate the row's bottom air.
    expect(mixin).toMatch(/left:\s*0/);
  });

  it("keeps the texture off the text band", () => {
    const candy = readFileSync(CANDY_FILE, "utf-8");
    const mixin = blockFor(candy, `@mixin ${MIXIN}`) ?? "";

    // Same "this is ON" texture as the transport's aux buttons...
    expect(mixin).toContain("mem-sprinkle");
    // ...but masked to the top and bottom edges. Without the mask it runs
    // straight through the two text lines, and the muted columns (album, date,
    // duration) are what stop being readable first.
    expect(mixin).toMatch(/-webkit-mask-image:/);
    expect(mixin).toMatch(/[^-]mask-image:/);
    // The row's content has to sit above it, or the sprinkle paints ON the title.
    expect(mixin).toMatch(/>\s*\*\s*\{[^}]*z-index/);
  });

  // Two tests lived here for the queue row's own copy of this state — pinned
  // ink on the yellow fill, and a drop marker that used `box-shadow` because
  // both pseudo-elements were taken. They went with `TrackItem.vue` (#416).
});
