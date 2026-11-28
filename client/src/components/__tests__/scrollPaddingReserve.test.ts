import { readdirSync, readFileSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The player bar overlays the foot of every scroller, and each one reserves
// the bar's height as padding-bottom so its last row can scroll clear of it.
// Keyboard focus and `scrollIntoView` ignore padding: they only respect
// `scroll-padding`. Without a scroll-padding-bottom a tabbed-to element stops
// where it touches the scroller's bottom edge — under the bar. Measured
// 2026-11-26 at 1440x900: the Rewind link on /stats sat 82px under the bar;
// at 390x844, 179px under it.
//
// So the reserve mixin sets both values from the same token, and this census
// pins the three things that drifted before: the two values per breakpoint,
// every page scroller taking the mixin, and no other stylesheet or page host
// re-declaring the bottom padding (an ID selector such as `#p-view` beat the
// mixin at 32px against an 82/179/60px bar and kept the last rows under it).
// A fourth: in a track row the focus lands on a link INSIDE the row, so the
// row's links carry half a row of scroll margin (g).
// ---------------------------------------------------------------------------

/** Comments name the very declarations this census looks for — strip them first. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'])\/\/[^\n]*/g, (_match, lead: string) => lead)
    .replace(/<!--[\s\S]*?-->/g, "");
}

/** Index of the `}` that closes the `{` at `open`. Throws if unbalanced. */
function matchBrace(text: string, open: number): number {
  if (text[open] !== "{") throw new Error(`expected "{" at ${open}`);
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  throw new Error(`unbalanced braces after ${open}`);
}

/** Inner text of the first block whose header matches `header` (regex ends in `\{`). */
function innerOf(text: string, header: RegExp): string {
  const m = header.exec(text);
  if (!m) return "";
  const open = m.index + m[0].length - 1;
  return text.slice(open + 1, matchBrace(text, open));
}

/**
 * Splits `text` into its top-level blocks and the declarations outside any block.
 *
 * Sass interpolation `#{…}` is a value, not a block: read as one, it swallowed
 * the declaration around it (`padding-bottom: calc(#{$padbottom} + …)` became a
 * nested "rule" and was dropped), and (f) went green on exactly that mutation.
 */
function topLevel(text: string): { blocks: { header: string; body: string }[]; loose: string } {
  const blocks: { header: string; body: string }[] = [];
  let loose = "";
  let seg = 0;
  let i = 0;
  while (i < text.length) {
    if (text[i] === "{" && text[i - 1] === "#") {
      i = matchBrace(text, i) + 1;
    } else if (text[i] === "{") {
      const pre = text.slice(seg, i);
      const cut = pre.lastIndexOf(";");
      loose += pre.slice(0, cut + 1);
      const header = pre.slice(cut + 1).trim();
      const close = matchBrace(text, i);
      blocks.push({ header, body: text.slice(i + 1, close) });
      i = close + 1;
      seg = i;
    } else {
      i++;
    }
  }
  loose += text.slice(seg);
  return { blocks, loose };
}

/** A rule's own declarations: nested selector blocks dropped, `@` blocks (include, media) kept. */
function directDecls(body: string): string {
  const { blocks, loose } = topLevel(body);
  return [loose, ...blocks.filter((b) => b.header.startsWith("@")).map((b) => directDecls(b.body))].join("\n");
}

/** Every selector rule in a stylesheet, with its direct declarations. */
function allRules(text: string): { selector: string; decls: string }[] {
  const out: { selector: string; decls: string }[] = [];
  for (const block of topLevel(text).blocks) {
    if (!block.header.startsWith("@")) out.push({ selector: block.header, decls: directDecls(block.body) });
    out.push(...allRules(block.body));
  }
  return out;
}

/** Removes the first `@include name { … }` from `body`; returns its inner text and the remainder. */
function takeInclude(body: string, name: string): { inner: string; rest: string } | null {
  const m = new RegExp(`@include\\s+${name}\\s*\\{`).exec(body);
  if (!m) return null;
  const open = m.index + m[0].length - 1;
  const close = matchBrace(body, open);
  return { inner: body.slice(open + 1, close), rest: body.slice(0, m.index) + body.slice(close + 1) };
}

/** Every file under `dir` (relative to client/) whose name ends in one of `exts`. */
function walk(dir: string, exts: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = `${dir}/${name}`;
    if (statSync(path).isDirectory()) out.push(...walk(path, exts));
    else if (exts.some((ext) => name.endsWith(ext))) out.push(path);
  }
  return out;
}

/** The value of each declaration `prop:` (not matching a longer property such as `scroll-padding-bottom`). */
function valuesOf(text: string, prop: string): string[] {
  const re = new RegExp(`(?<![\\w-])${prop}\\s*:\\s*([^;}]+)`, "g");
  return [...text.matchAll(re)].map((m) => m[1].trim().replace(/\s+/g, " "));
}

const TOKEN = /\$bottombarheight(?:-phone|-short)?(?![\w-])/;

// ---------------------------------------------------------------------------
// (a)–(c): the mixin itself
// ---------------------------------------------------------------------------

const MIXIN_FILE = "src/assets/scss/_mixins.scss";
const mixinSource = stripComments(readFileSync(MIXIN_FILE, "utf-8"));
const mixinBody = innerOf(mixinSource, /@mixin\s+player-bar-reserve\b[^{]*\{/);
const phoneTake = takeInclude(mixinBody, "allPhones");
const shortTake = takeInclude(phoneTake?.rest ?? mixinBody, "shortViewport");

const PARTS = [
  { name: "base", body: shortTake?.rest ?? "", expected: "$bottombarheight" },
  { name: "allPhones", body: phoneTake?.inner ?? "", expected: "$bottombarheight-phone" },
  { name: "shortViewport", body: shortTake?.inner ?? "", expected: "$bottombarheight-short" },
];

describe("player-bar-reserve sets scroll-padding from the same token as padding", () => {
  it("finds the mixin body and both breakpoint blocks", () => {
    expect(mixinBody.trim(), `@mixin player-bar-reserve not found in ${MIXIN_FILE}`).not.toBe("");
    expect(phoneTake, "@include allPhones block missing from the mixin").not.toBeNull();
    expect(shortTake, "@include shortViewport block missing from the mixin").not.toBeNull();
  });

  it.each(PARTS.map((p) => [p.name, p.body, p.expected] as const))(
    "%s: one padding-bottom and one scroll-padding-bottom, both on the expected token",
    (name, body, expected) => {
      const paddings = valuesOf(body, "padding-bottom");
      const scrolls = valuesOf(body, "scroll-padding-bottom");

      expect(paddings, `${name}: exactly one padding-bottom`).toHaveLength(1);
      expect(scrolls, `${name}: exactly one scroll-padding-bottom`).toHaveLength(1);

      const paddingToken = paddings[0].match(TOKEN)?.[0];
      const scrollToken = scrolls[0].match(TOKEN)?.[0];

      expect(scrollToken, `${name}: scroll-padding-bottom must use the same bar token as padding-bottom`).toBe(
        paddingToken
      );
      expect(scrollToken, `${name}: wrong bar token for this breakpoint`).toBe(expected);
      expect(scrolls[0], `${name}: scroll-padding-bottom must be the bar plus $bar-focus-clearance`).toBe(
        `calc(${expected} + $bar-focus-clearance)`
      );
    }
  );

  it("each part of the mixin was actually inspected", () => {
    for (const part of PARTS) {
      expect(part.body.trim(), `${part.name} body is empty`).not.toBe("");
    }
  });
});

// ---------------------------------------------------------------------------
// (d): every page scroller takes the mixin
// ---------------------------------------------------------------------------

describe("every page scroller takes the reserve mixin", () => {
  const INCLUDE = /@include\s+player-bar-reserve\b/;

  it("app-grid: .content-page and the .v-scroll-page .scroller both include it", () => {
    const grid = stripComments(readFileSync("src/assets/scss/Global/app-grid.scss", "utf-8"));

    const contentPage = innerOf(grid, /(?:^|\n)\.content-page\s*\{/);
    expect(contentPage.trim(), ".content-page rule not found in app-grid.scss").not.toBe("");
    expect(contentPage, ".content-page must include player-bar-reserve").toMatch(INCLUDE);

    const vScrollPage = innerOf(grid, /(?:^|\n)\.v-scroll-page\s*\{/);
    expect(vScrollPage.trim(), ".v-scroll-page rule not found in app-grid.scss").not.toBe("");
    const scroller = innerOf(vScrollPage, /\.scroller\s*\{/);
    expect(scroller.trim(), ".scroller rule nested in .v-scroll-page not found").not.toBe("");
    expect(scroller, ".v-scroll-page .scroller must include player-bar-reserve").toMatch(INCLUDE);
  });

  it("search top results include it without the content-page class", () => {
    const vue = readFileSync("src/views/SearchView/TopResults.vue", "utf-8");
    const styles = [...vue.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => stripComments(m[1])).join("\n");

    const block = innerOf(styles, /\.search-page-top-results\s*\{/);
    expect(block.trim(), ".search-page-top-results rule not found in TopResults.vue").not.toBe("");
    expect(block, ".search-page-top-results must include player-bar-reserve").toMatch(INCLUDE);
  });
});

// ---------------------------------------------------------------------------
// (e): nothing else sets a block-axis scroll padding
// ---------------------------------------------------------------------------

describe("no stylesheet sets a block-axis scroll padding outside the reserve", () => {
  // `scroll-padding-inline` (Stats chart chips, a horizontal scroller) is not
  // a conflict: the regex only accepts the block-axis names.
  const SCROLL_PADDING = /(?<![\w-])scroll-padding(?:-block(?:-end|-start)?|-bottom|-top)?\s*:/g;
  const MIXIN_ALLOWED = "src/assets/scss/_mixins.scss";
  const GRID_ALLOWED = "src/assets/scss/Global/app-grid.scss";

  const files = walk("src", [".scss", ".vue"]).map((path) => ({
    path,
    source: stripComments(readFileSync(path, "utf-8")),
  }));
  const vueCount = files.filter((f) => f.path.endsWith(".vue")).length;

  it("walked the whole tree and saw the allowed mixin match", () => {
    expect(vueCount, "walk found too few .vue files — the census would be meaningless").toBeGreaterThan(100);

    const mixin = files.find((f) => f.path === MIXIN_ALLOWED);
    expect(mixin, `${MIXIN_ALLOWED} not walked`).toBeTruthy();
    expect(mixin!.source.match(SCROLL_PADDING)?.length ?? 0, "the mixin's scroll-padding-bottom was not seen").toBeGreaterThan(0);
  });

  it("the edit-mode override in app-grid uses only the safe-area inset, not the bar", () => {
    const grid = files.find((f) => f.path === GRID_ALLOWED);
    expect(grid, `${GRID_ALLOWED} not walked`).toBeTruthy();

    const values = valuesOf(grid!.source, "scroll-padding-bottom");
    expect(values, "app-grid.scss: exactly one scroll-padding-bottom (the edit-mode override)").toHaveLength(1);
    expect(values[0]).toContain("env(safe-area-inset-bottom");
    expect(values[0]).not.toMatch(/\$bottombarheight/);
  });

  it("no other .scss or .vue file sets scroll-padding on the block axis", () => {
    const offenders: string[] = [];
    for (const { path, source } of files) {
      if (path === MIXIN_ALLOWED || path === GRID_ALLOWED) continue;
      const matches = source.match(SCROLL_PADDING);
      if (matches) offenders.push(`${path}: ${matches.join(" ")}`);
    }

    expect(
      offenders,
      `scroll-padding on the block axis belongs in player-bar-reserve (or the edit-mode override) — offenders:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (f): a page host does not re-declare the reserve's bottom padding
// ---------------------------------------------------------------------------

describe("a content-page host does not re-declare the bottom padding", () => {
  const views = walk("src/views", [".vue"]);
  const audited: string[] = [];
  const scrollingRules: string[] = [];
  const offenders: string[] = [];

  for (const path of views) {
    const raw = readFileSync(path, "utf-8");
    const template = raw.replace(/<style[\s\S]*?<\/style>/g, "");
    const hasContentPage = [...template.matchAll(/(?<![:\w-])class="([^"]*)"/g)].some((m) =>
      /\bcontent-page\b/.test(m[1])
    );
    if (!hasContentPage) continue;

    audited.push(path);
    const styles = [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => stripComments(m[1])).join("\n");

    for (const rule of allRules(styles)) {
      const scrolls =
        /(?<![\w-])overflow\s*:[^;}]*\b(?:auto|scroll)\b/.test(rule.decls) ||
        /(?<![\w-])overflow-y\s*:\s*(?:auto|scroll)\b/.test(rule.decls);
      if (!scrolls) continue;
      scrollingRules.push(`${path}: ${rule.selector}`);

      const padsBottom = /(?<![\w-])padding-bottom\s*:/.test(rule.decls) || /(?<![\w-])padding\s*:/.test(rule.decls);
      if (padsBottom) offenders.push(`${path}: ${rule.selector}`);
    }
  }

  it("audited enough page hosts and saw at least one scrolling rule", () => {
    expect(audited.length, "too few content-page hosts audited — the parser may be blind").toBeGreaterThanOrEqual(5);
    expect(scrollingRules.length, "no scrolling rule was seen — the parser may be blind").toBeGreaterThanOrEqual(1);
  });

  it("no content-page host sets padding-bottom on a scrolling element", () => {
    expect(
      offenders,
      `content-page hosts must leave the bottom padding to .content-page (player-bar-reserve) — offenders:\n${offenders.join("\n")}`
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// (g): a focused link inside a track row brings the whole row
// ---------------------------------------------------------------------------

describe("a track row's links carry the row's edge when focused", () => {
  // Focus scrolling clears the focused element, not its row. The artist link
  // ends 17px above the row's foot, so with scroll-padding alone the row's last
  // 10px stayed under the bar (measured at 1440x900 and 390x844).
  it("SongItem gives the row's links and buttons half a row of scroll margin", () => {
    const vue = readFileSync("src/components/shared/SongItem.vue", "utf-8");
    const styles = [...vue.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => stripComments(m[1])).join("\n");

    const row = innerOf(styles, /(?:^|\n)\.songlist-item\s*\{/);
    expect(row.trim(), ".songlist-item rule not found in SongItem.vue").not.toBe("");

    const targets = topLevel(row).blocks.filter((b) => b.header.replace(/\s+/g, " ") === "a, button");
    expect(targets, "`.songlist-item { a, button { … } }` not found in SongItem.vue").toHaveLength(1);
    expect(valuesOf(targets[0].body, "scroll-margin-block")).toEqual(["calc($song-item-height / 2)"]);
  });
});
