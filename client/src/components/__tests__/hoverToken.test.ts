import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// THE POINTER SIGNAL HAS ONE SOURCE: `--mem-hover` (#418).
//
// Before this it had three, and two of them ignored the token that existed for
// exactly this purpose: `candy-row-hover` and `btn-action` each wrote
// `$mem-blush` by hand, while only `btn-quiet` read `$mem-hover`. Changing the
// hover colour therefore meant finding all three — and the question "is hover
// centralised?" had the answer "half".
//
// This test makes the answer permanent. It scans the two stylesheets that own
// hover treatments and fails when a hover rule paints a fill from anything but
// the token.
//
// Read with `readFileSync`, not `import.meta.glob`: the raw glob comes back
// EMPTY for `.scss` because Vite routes stylesheets through a CSS pipeline that
// is stubbed under test — no error, no undefined, just a silently green test.
// See .claude/rules/testing.md.
// ---------------------------------------------------------------------------
const FILES = ["src/assets/scss/_candy.scss", "src/assets/scss/Global/_buttons.scss"];

/**
 * Fills that a hover rule may NOT set — every one of them is an accent.
 *
 * Matched on a WORD BOUNDARY, not as a substring: `$candy-pink` otherwise also
 * matches `$candy-pink-deep`, which would report the right rule for the wrong
 * reason (that one is yellow, not pink).
 */
const FORBIDDEN = [
  "$mem-blush",
  "$mem-blush-soft-static",
  "$candy-pink",
  "$candy-pink-soft",
  "$candy-pink-deep",
  "$mem-panel-static",
  "$mem-soft",
  "$mem-yellow",
];

/** Source with comments stripped, so prose about blush does not trip the scan. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The bodies of every rule whose selector mentions `:hover`, nested rules
 * removed — a `&:hover { … }` block, not everything that surrounds it.
 */
function hoverBodies(source: string): { name: string; body: string }[] {
  const clean = code(source);
  const found: { name: string; body: string }[] = [];
  const opener = /([^\n{}]*(?::hover|-hover)[^{}]*)\{/g;

  for (let match = opener.exec(clean); match; match = opener.exec(clean)) {
    let depth = 0;
    let body = "";
    for (let i = match.index + match[0].length - 1; i < clean.length; i++) {
      const char = clean[i];
      if (char === "{") depth++;
      else if (char === "}") {
        depth--;
        if (depth === 0) break;
      }
      if (depth === 1 && char !== "{") body += char;
    }
    found.push({ name: match[1].trim(), body });
  }
  return found;
}

describe("hover has one source", () => {
  // A source-scanning test goes silently green when its parser breaks, so it
  // checks its own inputs first (.claude/rules/testing.md).
  it("finds the hover rules it claims to check", () => {
    const all = FILES.flatMap(file => hoverBodies(readFileSync(file, "utf8")));
    expect(all.length).toBeGreaterThanOrEqual(3);

    const names = all.map(rule => rule.name).join(" | ");
    expect(names).toMatch(/mem-row-plate-hover|candy-row-hover/);
    expect(names).toMatch(/:hover/);
  });

  it.each(FILES)("%s paints no hover fill outside the token", file => {
    const offenders: string[] = [];

    for (const { name, body } of hoverBodies(readFileSync(file, "utf8"))) {
      // `--row-fill` is the plate's indirection for the same token; it counts
      // as reading it, not as a second source.
      const fill = body.match(/(?:background-color|--row-fill)\s*:\s*([^;]+);/g) ?? [];
      for (const decl of fill) {
        const hit = FORBIDDEN.find(bad =>
          // `\$` for the sigil, `(?![\w-])` so `$candy-pink` does not swallow
          // `$candy-pink-deep` — a substring match names the wrong token.
          new RegExp(`\\${bad}(?![\\w-])`).test(decl)
        );
        if (hit) offenders.push(`${name}: ${decl.trim()} (${hit})`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it("keeps the text and hatch tokens beside the fill", () => {
    // The fill went dark in the light theme, so a hover that swaps the surface
    // without swapping what sits on it leaves ink on ink. Both mixins that own
    // a hover surface have to name the text token.
    const candy = readFileSync("src/assets/scss/_candy.scss", "utf8");
    for (const mixin of ["candy-row-hover", "mem-row-plate-hover"]) {
      const body = hoverBodies(candy).find(rule => rule.name.includes(mixin))?.body ?? "";
      expect(body, `${mixin} does not set --mem-hover-text`).toMatch(/--mem-hover-text/);
    }
  });
});

// ---------------------------------------------------------------------------
// THE SAME RULE AT EVERY CALL SITE — because the first census stopped at the
// two central stylesheets, and that boundary was exactly where the bugs lived.
//
// When #422 made the hover fill the CONTRAST surface, five call sites kept
// painting the token fill without flipping what sits on it — the home page's
// browse tiles, the SEE-ALL sticker and every cover tile's plates went solid
// ink with invisible ink text on hover. All five were outside the two files
// the census read.
//
// So: in EVERY stylesheet of the app, a rule under a `:hover` selector that
// paints the token fill must name `--mem-hover-text` in the same block (or
// include one of the two row mixins, which carry it). Stating the text token
// where the fill is stated is the convention — even where a role would supply
// it anyway — because "the two only ever move together" is the entire lesson
// of this round.
// ---------------------------------------------------------------------------
function sourceFiles(dir: string): string[] {
  // Hand-rolled walk instead of `readdirSync(..., { recursive: true })`, which
  // needs a newer Node than this repo pins.
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "node_modules" && entry !== "__tests__") found.push(...sourceFiles(path));
    } else if (/\.(scss|vue)$/.test(entry)) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Every rule whose selector mentions `:hover`, with its FULL body — nested
 * rules included, and selector lists that span lines (`&:hover,\n&.open {`)
 * recognised. The narrower `hoverBodies` above deliberately excludes nested
 * content to attribute a declaration to one rule; this scan needs the opposite,
 * because a tile's hover block restyles its child plates.
 */
function hoverBlocksDeep(source: string): { name: string; body: string }[] {
  const clean = code(source);
  const found: { name: string; body: string }[] = [];

  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== "{") continue;
    // The selector is everything since the previous `{`, `}` or `;`.
    const start = Math.max(...[...";{}"].map(stop => clean.lastIndexOf(stop, i - 1)));
    const selector = clean.slice(start + 1, i).trim();
    if (!/:hover/.test(selector)) continue;

    let depth = 0;
    let end = i;
    for (let j = i; j < clean.length; j++) {
      if (clean[j] === "{") depth++;
      else if (clean[j] === "}") {
        depth--;
        if (depth === 0) {
          end = j;
          break;
        }
      }
    }
    found.push({ name: selector.replace(/\s+/g, " "), body: clean.slice(i + 1, end) });
  }
  return found;
}

describe("hover call sites keep the text token beside the fill", () => {
  const files = sourceFiles("src");

  it("finds the files and hover blocks it claims to check", () => {
    // Self-check first (.claude/rules/testing.md): a walker or parser that
    // breaks must not go silently green. The two known token call sites stand
    // in for "the scan reaches vue AND scss files".
    expect(files.length).toBeGreaterThan(100);
    const browse = hoverBlocksDeep(readFileSync("src/components/HomeView/Browse.vue", "utf8"));
    const cards = hoverBlocksDeep(readFileSync("src/assets/scss/Global/cards.scss", "utf8"));
    expect(browse.some(rule => /background-color/.test(rule.body))).toBe(true);
    expect(cards.some(rule => /--mem-hover-text/.test(rule.body))).toBe(true);
  });

  it("never paints the token fill without flipping the text", () => {
    const offenders: string[] = [];
    const fillsToken = /(?:background-color|--row-fill)\s*:[^;]*(?:\$mem-hover(?![\w-])|var\(--mem-hover\))/;
    const flipsText = /--mem-hover-text|@include\s+(?:candy-row-hover|mem-row-plate-hover)/;

    for (const file of files) {
      for (const { name, body } of hoverBlocksDeep(readFileSync(file, "utf8"))) {
        if (fillsToken.test(body) && !flipsText.test(body)) {
          offenders.push(`${file} → ${name}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// THE POINTER FLIP IS A CUT, NOT A FADE (styling.md).
//
// Since the hover fill is the CONTRAST surface, fill and text swap in opposite
// directions on hover. A transition therefore has a mid-frame where both sit
// at grey — the contrast collapses, and the flip reads as "the black arrives
// at two different places" (the user's exact report). The hatch cannot fade at
// all (it is an image swap), so a colour fade is also always out of step with
// the texture.
//
// The rule this pins: in the two stylesheets that own the roles and the row
// anatomy, no `transition` may name a colour property. Motion (box-shadow,
// transform) stays eased — the paint switches in one frame.
// ---------------------------------------------------------------------------
describe("the pointer flip is a cut", () => {
  it.each(FILES)("%s eases motion only, never paint", file => {
    const clean = code(readFileSync(file, "utf8"));
    const offenders: string[] = [];
    // Multi-line lists: match from `transition:` to the closing semicolon.
    for (const match of clean.match(/transition\s*:[^;]+;/g) ?? []) {
      if (/background-color|border-color|[^-]color\s*[, $]|[^-]color\s*;/.test(match)) {
        offenders.push(match.replace(/\s+/g, " ").trim());
      }
    }
    expect(offenders).toEqual([]);
  });

  it("still sees transitions at all", () => {
    // Parser self-check: if the extraction regex rots, the test above goes
    // silently green. The roles do declare motion transitions — find them.
    const buttons = code(readFileSync("src/assets/scss/Global/_buttons.scss", "utf8"));
    expect((buttons.match(/transition\s*:[^;]+;/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
