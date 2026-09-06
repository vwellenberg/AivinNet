import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { blocks, ownDeclarations, shorthandLeft, shorthandParts, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A section caption on the page ground is a STICKER (`mem-sticker`), never bare
// text.
//
// The ground is grid paper *plus* the memphis doodles, and the doodle tile is
// 3840x1600 — so "a shape happens to sit behind this word" is the normal case,
// not the exception. Every caption in the app had already answered that: the
// card-row captions, "Top Tracks", "Browse Library", "Up Next" / "Queue", the
// chart groups, the page titles, and the recent-searches head. The two on the
// search page's Top tab ("Top Result", "Tracks") never were — they carried a
// theme-aware `color` and nothing else, which does nothing about a saturated
// shape running behind them. Reported by the user off a screenshot of that tab.
//
// The point of the census is the SHAPE of that miss: neither caption looked
// wrong in its own file. It only shows next to the sticker one screen over. So
// this test COLLECTS the hosts (every component that renders an <h2>/<h3>)
// rather than listing the known ones, and makes each of them answer: sticker,
// or an entry below saying which surface it sits on instead. A new page-level
// caption fails here until someone decides which it is.
//
// Scope note: headings are the enumerable half. Captions that are not heading
// elements — CardScroller's `.rtitle` (<b>), `SeeAll` — carry `mem-sticker`
// through their own rules and are covered by nothing here; a heading element is
// what a new section caption is written as.
// ---------------------------------------------------------------------------

/**
 * Hosts whose heading does NOT sit on the page ground, with the surface it sits
 * on instead. An entry here is a claim that has to stay true.
 */
const NOT_ON_THE_GROUND: Record<string, string> = {
  "components/DeviceSync/GestureOverlay.vue": "the join prompt paints its own veil sheet",
  // The two sidebar entries that used to sit here (QueueActions, the sidebar's
  // own TopResults) went with the panel rewrite — see #416.
  "components/RightSideBar/Search/Top/TopItem.vue": "the top-result card's own title, on the card",
  "components/SettingsView/About.vue": "inside the settings modal",
  "components/modals/RootDirsPrompt.vue": "inside a modal",
  "views/PairView.vue": "on the pairing plate",
};

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

/** A component's template, with HTML comments removed. */
function template(source: string): string {
  const end = source.indexOf("<style");
  return (end === -1 ? source : source.slice(0, end)).replace(/<!--[\s\S]*?-->/g, "");
}

/** The opening tags of every <h2>/<h3> a template renders. */
function headings(source: string): string[] {
  return template(source).match(/<h[23](?:\s[^>]*)?>/g) ?? [];
}

/**
 * The selectors a heading's own rule could be written as: each of its classes,
 * plus the element name. A `:class` binding is deliberately ignored — a caption
 * whose sticker hangs off a conditional class is not stickered in every state.
 */
function selectorsFor(tag: string): string[] {
  const classes = (/\sclass="([^"]*)"/.exec(tag)?.[1] ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .map(name => `.${name}`);
  return [...classes, tag.slice(1, 3)];
}

const HOSTS = [...vueFiles("views"), ...vueFiles("components")]
  .map(path => ({ path, source: readFileSync(join("src", path), "utf-8") }))
  .filter(({ source }) => headings(source).length > 0);

describe("section captions on the page ground are stickers", () => {
  // A source-scanning test goes quietly green when its parser breaks, so the
  // input set is asserted before anything is asserted about it.
  it("finds the heading hosts", () => {
    expect(HOSTS.length).toBeGreaterThan(5);
    for (const known of Object.keys(NOT_ON_THE_GROUND)) {
      expect(
        HOSTS.map(h => h.path),
        `${known} no longer renders a heading — drop its entry`
      ).toContain(known);
    }
  });

  it.each(HOSTS)("$path either stickers its caption or names its surface", ({ path, source }) => {
    if (NOT_ON_THE_GROUND[path]) return;

    // Comments stripped: the prose above these rules names the mixin, so raw
    // source would stay green after the rule itself was deleted.
    const style = styleBlock(source);

    // Per HEADING, not per file. "the file mentions mem-sticker somewhere" was
    // the first cut and it is not a census: it lets a second, bare caption into
    // a component that already stickers its first one — which is precisely the
    // shape this test exists for.
    for (const tag of headings(source)) {
      const stickered = selectorsFor(tag).some(selector =>
        blocks(style, selector).some(body => body.includes("mem-sticker"))
      );
      expect(
        stickered,
        `${path} renders ${tag} on the page ground with no mem-sticker rule for it — ` +
          "give it the mixin, or add the file to NOT_ON_THE_GROUND with the surface it sits on"
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// ...and a sticker sits FLUSH with what it labels.
//
// The same captions that were bare text once carried a left inset for the
// reason bare text needs one: keeping the word off the page edge. A sticker
// carries that gap inside itself (the chip's padding), so the leftover margin
// only moves the plate out of the line its own rows keep — measured on the
// deployed app, "Up Next"/"Queue" stood 16px (8px in the narrow column) right
// of the tracks they label, while every caption on Home sits flush at 303.
//
// Two halves, because the leftover was written both ways and only one of them
// moves the plate:
//
//   MARGIN-left  — moves the chip off the line. Must be zero.
//   PADDING-left — grows the chip inwards, so the plate stays put and the TEXT
//                  drifts. It is the chip's own space and `mem-sticker` sets
//                  both sides at once; a rule that touches one side alone makes
//                  it lopsided (Artist/Favorites "Top Tracks": 16px left
//                  against 8px right). So padding is checked for SYMMETRY, not
//                  for zero — a caption is free to be a bigger chip.
//
// The vertical margins are the air between sections and no business of this.
//
// ⚠️ Known blind spot, stated rather than left to be discovered: a FOREIGN file
// reaching a caption through an ELEMENT selector (`.fav-tracks h3 { … }`) is not
// covered. Class selectors are, compound forms included — a caption's class is
// app-wide, so those are enumerable — but `h3` app-wide would flag every card
// title in the app. The two foreign insets found here were removed and the rule
// in styling.md says where a caption's rules belong; this census cannot prove
// the next one.
// ---------------------------------------------------------------------------


/**
 * The bodies of every rule whose selector ENDS in this class — including the
 * compound forms `blocks()` cannot see, because it wants the selector followed
 * directly by `{`. `.section-title.isSmall { padding-left: … }` is one of the
 * rules this census removed, and without this it could come back green.
 *
 * A trailing descendant (`.section-title .badge`) is deliberately NOT matched:
 * that styles a child, not the caption.
 */
function classBlocks(css: string, classSelector: string): string[] {
  const name = classSelector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opener = new RegExp(`\\.${name}(?![\\w-])(?:[.:#\\[][^\\s{,]*)*\\s*[{,]`, "g");
  const out: string[] = [];

  for (const match of css.matchAll(opener)) {
    // A selector list (`.a, .b { … }`) — walk on to the brace that opens it.
    let i = match.index! + match[0].length - 1;
    while (i < css.length && css[i] !== "{") {
      if (css[i] === ";" || css[i] === "}") break;
      i++;
    }
    if (css[i] !== "{") continue;

    let depth = 1;
    let j = i + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    out.push(css.slice(i + 1, j - 1));
  }
  return out;
}

/** The side values a rule sets for one box, in source order (shorthands too). */
function sides(declarations: string, box: "margin" | "padding"): { left: string[]; right: string[] } {
  const left: string[] = [];
  const right: string[] = [];
  const pattern = new RegExp(`${box}(-left|-right)?\\s*:\\s*([^;{}]+)`, "g");

  for (const [, side, raw] of declarations.matchAll(pattern)) {
    // `!important` says how hard a value pushes, not how far — and every
    // override of this kind in the app is written with it.
    const value = raw.replace(/!important/g, "").trim();
    if (side === "-left") left.push(value);
    else if (side === "-right") right.push(value);
    else {
      const horizontal = shorthandLeft(value);
      if (horizontal !== null) {
        left.push(horizontal);
        // Only the 4-value form can differ left from right.
        const parts = shorthandParts(value);
        right.push(parts.length === 4 ? parts[1] : horizontal);
      }
    }
  }
  return { left, right };
}

// `auto` passes: it is not a fixed inset, and on the `inline-flex` chip these
// captions are it resolves to 0 anyway.
const isZero = (value: string) => /^(0[a-z%]*|auto)$/.test(value);

/** The bodies of every rule in one stylesheet that can reach a heading. */
function rulesFor(css: string, tag: string): string[] {
  return selectorsFor(tag)
    .flatMap(selector => (selector.startsWith(".") ? classBlocks(css, selector) : blocks(css, selector)))
    .map(ownDeclarations);
}

/**
 * Every stylesheet in the app: the components' own <style> blocks and the
 * global partials.
 *
 * Needed because a caption's inset does not have to live in the caption's own
 * file, and the two that survived the first pass here did not: the artist page
 * wrote `.artist-page .section-title { padding-left: 1rem }` and the favorites
 * page `.fav-tracks .artist-top-tracks h3 { padding-right: $small }`, each
 * reaching a caption defined one component away. A per-file census reads green
 * on both — measured on the built app, the chip was still 16px/11.2px.
 */
const STYLESHEETS: { path: string; css: string }[] = [
  ...[...vueFiles("views"), ...vueFiles("components")].map(path => ({
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

/** Every rule in ANOTHER file that targets one of these class selectors. */
function foreignRulesTargeting(classSelectors: string[], own: string): { path: string; declarations: string }[] {
  const out: { path: string; declarations: string }[] = [];
  for (const { path, css } of STYLESHEETS) {
    if (path === own) continue;
    for (const selector of classSelectors) {
      for (const body of classBlocks(css, selector)) out.push({ path, declarations: ownDeclarations(body) });
    }
  }
  return out;
}

/** The rules that style a heading, resolved the way the cascade resolves them. */
function captionRules(style: string, tag: string): string[] {
  // Class rules before the element rule, and the element rule only when no
  // class rule exists — which is how the cascade resolves it. The search page
  // writes `h3 { margin: $small }` for the title INSIDE the top-result card and
  // `.section-title { … }` for the two captions on the ground; reading both as
  // the caption's own would fail a heading whose rendered inset is 0.
  //
  // Every rule the winning selector has, though, not just the one holding the
  // sticker: the inset that started this lived in a SEPARATE block outside the
  // component's own nesting (`.now-playing-view.isSmall … {}`), which is where
  // a narrow-layout override naturally goes.
  const selectors = selectorsFor(tag);
  const byClass = selectors.filter(selector => selector.startsWith("."));
  const found = byClass.flatMap(selector => classBlocks(style, selector));
  if (found.length) return found.map(ownDeclarations);
  return selectors
    .filter(selector => !selector.startsWith("."))
    .flatMap(selector => blocks(style, selector))
    .map(ownDeclarations);
}

describe("a caption sticker keeps the page's leading edge", () => {
  // Both paths through captionRules() are guarded, or a parser that stopped
  // matching would leave the loop below with nothing to assert and go green.
  // The element path is the one PlaylistCardGroup's bare <h3> rides.
  it.each([
    ["components/NowPlaying/Header.vue", "class"],
    ["components/PlaylistsList/PlaylistCardGroup.vue", "element"],
  ])("reads the %s caption's own rules (%s selector)", path => {
    const host = HOSTS.find(h => h.path === path);
    expect(host, `${path} no longer renders a heading`).toBeTruthy();
    const style = styleBlock(host!.source);
    for (const tag of headings(host!.source)) {
      expect(captionRules(style, tag).length, `no rule found for ${tag} in ${path}`).toBeGreaterThan(0);
    }
  });

  it.each(HOSTS)("$path leaves its caption on the leading edge", ({ path, source }) => {
    if (NOT_ON_THE_GROUND[path]) return;

    const style = styleBlock(source);
    for (const tag of headings(source)) {
      for (const rule of captionRules(style, tag)) {
        for (const left of sides(rule, "margin").left) {
          expect(
            isZero(left),
            `${path} insets ${tag} by ${left} — a sticker's own padding is the gap to its ` +
              "text, so a left margin only pushes the chip out of line with the rows below it"
          ).toBe(true);
        }
      }

      // A caption's class is app-wide, so a page one directory over can reach
      // it — and both remaining insets did. Each of those rules answers for
      // itself: it may not move the plate either.
      const foreign = foreignRulesTargeting(
        selectorsFor(tag).filter(selector => selector.startsWith(".")),
        path
      );
      for (const { path: from, declarations } of foreign) {
        for (const left of sides(declarations, "margin").left) {
          expect(
            isZero(left),
            `${from} insets ${tag} (of ${path}) by ${left} — a caption keeps the page's leading edge`
          ).toBe(true);
        }
      }

      // Padding is read across every rule that can reach the heading — class
      // and element alike, here and in the other files — and each FILE answers
      // for itself. Not cascade-resolved like the margin above: `mem-sticker`
      // sets the chip in the class rule, and `padding-left: 1rem` on the bare
      // `h3` or from another page's stylesheet beats it. Per file, because a
      // symmetric chip in one file must not vouch for a one-sided override in
      // the next.
      const perFile = new Map<string, { left: string[]; right: string[] }>();
      for (const rule of [
        ...rulesFor(style, tag).map(declarations => ({ path, declarations })),
        ...foreign,
      ]) {
        const own = sides(rule.declarations, "padding");
        const seen = perFile.get(rule.path) ?? { left: [], right: [] };
        perFile.set(rule.path, { left: [...seen.left, ...own.left], right: [...seen.right, ...own.right] });
      }

      for (const [from, padding] of perFile) {
        if (!padding.left.length && !padding.right.length) continue;
        // The side a file leaves alone comes from the mixin — a DIFFERENT value
        // than the one being written, which is the lopsidedness itself.
        const last = (values: string[]) => values[values.length - 1] ?? "from mem-sticker";
        expect(
          last(padding.left),
          `${from} pads ${tag} (of ${path}) unevenly — left ${last(padding.left)}, ` +
            `right ${last(padding.right)}. mem-sticker sets both sides of the chip; ` +
            "overriding one alone makes it lopsided"
        ).toBe(last(padding.right));
      }
    }
  });
});

describe("the search page's Top tab", () => {
  const SFC = readFileSync("src/views/SearchView/TopResults.vue", "utf-8");
  const STYLE = styleBlock(SFC);

  it("marks both captions with the class the sticker rule is scoped to", () => {
    const headings = SFC.match(/<h3[^>]*>/g) ?? [];
    expect(headings).toHaveLength(2);
    for (const heading of headings) {
      expect(heading, "a caption without .section-title gets no sticker").toContain("section-title");
    }
  });

  // The sticker must NOT hang off the bare `h3` selector in this file: it also
  // reaches the title inside the top-result card, which sits on a panel.
  it("scopes the sticker to the class, not to the element", () => {
    const stickerAt = STYLE.indexOf("mem-sticker");
    expect(stickerAt).toBeGreaterThan(-1);
    expect(STYLE.slice(0, stickerAt)).toMatch(/\.section-title\s*\{[^{}]*$/);
  });

  it("plates the track results on the content veil", () => {
    // The claim is unchanged — search results are content and must not sit on
    // the bare doodle tile — but the mechanism moved. The page used to paint a
    // veil plate around the rows because they were `TrackItem`, which brings no
    // surface. They are `SongItem` now (#416), which carries the translucent
    // list plate itself and closes its ink frame via is_first/is_last.
    //
    // So the assertion is: the rows are SongItem, and the page does NOT draw a
    // second plate around them (that would double the frame).
    const rows = readFileSync("src/components/RightSideBar/Search/Top/TopTracks.vue", "utf-8");

    expect(rows).toMatch(/<SongItem/);
    expect(rows).toMatch(/:is_first=/);
    expect(rows).toMatch(/:is_last=/);
    expect(STYLE).not.toMatch(/\.right-search-top-tracks\s*\{[^}]*--mem-veil/);
  });
});
