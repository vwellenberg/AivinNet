import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ownDeclarations, shorthandParts, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A block does not indent itself and hand the indent back.
//
// `.generichead` padded itself `$medium` on the left and gave it back with
// `.after { margin-left: -$medium }`. Net zero for the content slot — and 12px
// of drift for everything in the head that could NOT compensate: the page
// title and the description, on Albums, Artists, Playlists, Favorites, Stats
// and Charts at once (measured 315 against content at 303).
//
// That is why this is a census and not a fix note. The construction hides its
// own damage: whoever wrote the negative margin verified the thing they were
// looking at, and it WAS flush. What it costs is paid by the siblings, one
// component away, and only shows next to a page that does not do it.
//
// The rule is about the pair, not about either half. A negative margin is a
// fine tool, and the first cut of this census proved it by failing five rules
// that all use it correctly: a cover pulled out of a card's padding
// (`cards.scss`), a border overlapped by -2px (`SortBanner`, `RecentSearches`
// — those two are vertical margins and not even about the left edge), a popup
// positioned against its anchor (`ContextMenu`, `Settings .head`).
//
// What separates those from the bug is that the undo MATCHES the indent — same
// value, so the two cancel exactly. That is the signature of "the indent was
// never wanted": nobody writes `padding-left: $medium; margin-left: -$medium`
// to achieve something. Pulling a cover out by a cover-sized amount is a
// different, deliberate number.
//
// ⚠️ Compared as written, not as computed: `-$card-cover-pad` against
// `padding: 0.7rem` reads as different here even if the two resolve to the
// same length. Sass values are not available to a source scan, and a census
// that guesses at them would fail the legitimate rules again.
//
// ⚠️ Two more blind spots, stated rather than left to be found:
//   - Padding that comes from a MIXIN (`mem-sticker`, `btn-pill`, …) is
//     invisible here — the scan reads declarations, not expanded Sass. So the
//     pair is only caught where the indent is written out.
//   - A selector built by interpolation (`#{$card-types} { … }`) has no name a
//     source scan can hold on to, and its block is skipped.
// Both would need a real Sass pass to close, which is more machinery than the
// one bug this guards is worth. The measurement that FOUND the bug —
// `~/uitest/edgeaudit.js` on the running app — has neither blind spot.
// ---------------------------------------------------------------------------

/** Every `.scss` under the given root, relative to `src/`. */
function scssFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join("src", root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...scssFiles(root, rel));
    else if (entry.name.endsWith(".scss")) out.push(`${root}/${rel}`);
  }
  return out;
}

/** Every `.vue` under the given roots, relative to `src/`. */
function vueFiles(root: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join("src", root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...vueFiles(root, rel));
    else if (entry.name.endsWith(".vue")) out.push(`${root}/${rel}`);
  }
  return out;
}

const STYLESHEETS = [
  ...[...vueFiles("views"), ...vueFiles("components"), "App.vue"].map(path => ({
    path,
    css: styleBlock(readFileSync(join("src", path), "utf-8")),
  })),
  ...scssFiles("assets/scss").map(path => ({
    path,
    css: readFileSync(join("src", path), "utf-8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, ""),
  })),
];


/**
 * The left padding a rule sets on itself at the DEFAULT breakpoint, or null.
 *
 * `ownDeclarations` folds `@include allPhones { … }` into the body — right for
 * the sticker census, wrong here: a phone override that zeroes the padding
 * would erase the desktop indent this pair is about (and vice versa). So the
 * nested breakpoint blocks come off again first.
 */
function ownLeftPadding(body: string): string | null {
  const declarations = ownDeclarations(body).replace(/\{[^{}]*\}/g, "");
  let left: string | null = null;
  for (const [, side, raw] of declarations.matchAll(/padding(-left|-right|-top|-bottom)?\s*:\s*([^;{}]+)/g)) {
    const value = raw.replace(/!important/g, "").trim();
    if (side === "-left") left = value;
    else if (side) continue;
    else {
      const parts = shorthandParts(value);
      if (parts.length === 1) left = parts[0];
      else if (parts.length === 2 || parts.length === 3) left = parts[1];
      else if (parts.length === 4) left = parts[3];
    }
  }
  return left;
}

const isZero = (value: string) => /^(0[a-z%]*|auto)$/.test(value);

/**
 * Rules where indent and undo cancelling out is the POINT, keyed
 * `path::selector`, with what they are doing instead. An entry is a claim that
 * has to stay true.
 *
 * The card rows are the case: the padding is not an indent at all, it is the
 * text's own fill (`--row-fill`) reaching a little past the words so they read
 * against the cover art. The negative margin then keeps the text's left edge
 * exactly where it was — the opposite of what `.generichead` did, which moved
 * its children and compensated somewhere else.
 */
const DELIBERATE: Record<string, string> = {
  "assets/scss/Global/cards.scss::> *:not(.rhelp)": "the row text's own fill, kept off the text's edge",
  "assets/scss/Global/cards.scss::.rhelp .time": "same fill on the help row's two spans",
};

/**
 * Every negative LEFT margin inside a rule (its own or a descendant's), as the
 * bare amount without the sign. Shorthands count only when their left value is
 * the negative one — `margin: -2px 0` overlaps a border above and below and
 * has nothing to do with the leading edge.
 */
function leftPullsOf(body: string): string[] {
  const out: string[] = [];
  for (const [, side, raw] of body.matchAll(/margin(-left|-right|-top|-bottom)?\s*:\s*([^;{}]+)/g)) {
    const value = raw.replace(/!important/g, "").trim();
    let left: string | null = null;
    if (side === "-left") left = value;
    else if (side) continue;
    else {
      const parts = shorthandParts(value);
      if (parts.length === 1) left = parts[0];
      else if (parts.length === 2 || parts.length === 3) left = parts[1];
      else if (parts.length === 4) left = parts[3];
    }
    if (left?.startsWith("-")) out.push(left.slice(1).replace(/\s+/g, ""));
  }
  return out;
}

/**
 * Every rule body in a stylesheet, paired with the selector that opened it.
 * Nested bodies are yielded too — the pair can sit at any depth.
 */
function ruleBodies(css: string): { selector: string; body: string }[] {
  const out: { selector: string; body: string }[] = [];
  let i = 0;
  let pending = "";

  while (i < css.length) {
    const char = css[i];
    if (char === "{") {
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const body = css.slice(i + 1, j - 1);
      const selector = pending.trim().split(/[\n;}]/).pop()!.trim();
      if (selector && !selector.startsWith("@")) out.push({ selector, body });
      out.push(...ruleBodies(body));
      pending = "";
      i = j;
      continue;
    }
    pending += char;
    if (char === ";" || char === "}") pending = "";
    i++;
  }
  return out;
}

describe("no rule indents itself and takes the indent back", () => {
  // The guard: the parser has to still find rules at all, or this passes by
  // finding nothing. `.generichead` is the rule the census was written for.
  it("parses the stylesheets", () => {
    expect(STYLESHEETS.length).toBeGreaterThan(50);
    const head = STYLESHEETS.find(sheet => sheet.path === "components/shared/GenericHeader.vue");
    expect(head, "GenericHeader.vue is gone — retarget this guard").toBeTruthy();
    expect(ruleBodies(head!.css).some(rule => rule.selector.includes("generichead"))).toBe(true);
  });

  // Every exemption is a claim about a rule that still exists; a stale one
  // would silently widen the census's blind spot.
  it.each(Object.keys(DELIBERATE))("%s is still there to be exempt", key => {
    const [path, selector] = key.split("::");
    const sheet = STYLESHEETS.find(entry => entry.path === path);
    expect(sheet, `${path} is gone — drop its DELIBERATE entries`).toBeTruthy();
    expect(
      ruleBodies(sheet!.css).some(rule => rule.selector === selector),
      `${selector} is gone from ${path} — drop its DELIBERATE entry`
    ).toBe(true);
  });

  it.each(STYLESHEETS)("$path", ({ path, css }) => {
    for (const { selector, body } of ruleBodies(css)) {
      if (DELIBERATE[`${path}::${selector}`]) continue;
      const padding = ownLeftPadding(body);
      if (!padding || isZero(padding)) continue;

      // The undo: a negative LEFT margin anywhere inside this rule — its own
      // declarations or a child's — of exactly the indent's size.
      const undo = leftPullsOf(body).find(pull => pull === padding.replace(/\s+/g, ""));
      expect(
        undo ? `${selector} { padding-left: ${padding} } … { margin-left: -${undo} }` : null,
        `${path}: \`${selector}\` indents by ${padding} and takes it straight back with ` +
          `\`margin-left: -${undo}\` — the siblings that cannot compensate (a title, a caption) ` +
          "are left off the edge, one component away from where anyone would look. " +
          "Drop both halves instead of adding a third."
      ).toBeNull();
    }
  });
});
