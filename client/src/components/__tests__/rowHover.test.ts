import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Hover on a list row is ONE decision: `candy-row-base` + `candy-row-hover` in
// src/assets/scss/_candy.scss (light fill inside the ink frame, with the frame
// reserved as a transparent border so nothing shifts).
//
// This is a test rather than a comment because the same row drifted three
// times. The folder list hovered with no frame at all (`border: none`), the nav
// and playlist rows reserved the border but only ever coloured the fill, and
// the sidebar's folder header — the row the user reported — kept doing exactly
// that after both of those were fixed, sitting one line below a playlist row
// that drew the frame. Hand-writing `&:hover { background-color: … }` looks
// finished at the call site; only the neighbouring row reveals it isn't.
// ---------------------------------------------------------------------------

// Read through Vite rather than `fs`, so the test sees exactly the files the
// build sees. (`.scss` would come back EMPTY through this glob — see
// .claude/rules/testing.md — hence every row host here is a .vue file.)
const SOURCES = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

/** Every FLAT row list in the app, as file + the selector that owns the row. */
const ROWS = [
  { file: "/src/components/FolderView/FolderList.vue", selector: ".f-item" },
  { file: "/src/components/shared/SongItem.vue", selector: ".songlist-item" },
];

/**
 * The sidebar's rows left this treatment in #378: they are PLATES now (panel
 * fill, ink frame, offset shadow, hatch), so `candy-row-base` no longer applies
 * to them — but the drift it guarded against is the same one, so the census
 * moved rather than disappeared.
 *
 * `.sidebar-folder` is the folder's outer box; its head deliberately has NO
 * plate of its own (that is the "one plate per folder" decision) and is
 * therefore not listed here.
 */
const PLATES = [
  { file: "/src/components/LeftSidebar/index.vue", selector: ".sidebar-playlist-item", hatch: true },
  { file: "/src/components/LeftSidebar/index.vue", selector: ".sidebar-folder", hatch: true },
  { file: "/src/components/LeftSidebar/NavButtons.vue", selector: ".nav-item", hatch: true },
  // Charts rows are navigating plates too — they keep the veil fill through
  // the plate's own `--row-fill` indirection instead of the panel fill.
  //
  // `hatch: false` is deliberate (#468): the texture marks a control among
  // non-controls, and a full-width content list where every row is a control
  // has nothing for it to mark. Recorded here so the exception stays a decision
  // instead of becoming the new default — the sidebar plates must keep it.
  { file: "/src/components/Stats/ChartItem.vue", selector: ".chartitem", hatch: false },
  // The settings modal: its tab list navigates and its setting rows toggle, so
  // both are buttons by the #378 reading. They were the last flat rows in the
  // app, and the settings row was additionally the last place with 1px grey
  // hairlines between rows.
  //
  // The tab list is a sidebar — narrow rows between captions and a divider, so
  // the texture separates something. The setting rows are the chart-row case:
  // a 490px-wide list in which EVERY row is a control, two lines of type per
  // row, nothing for the texture to distinguish.
  { file: "/src/components/modals/settings/Sidebar.vue", selector: ".gitem", hatch: true },
  { file: "/src/components/SettingsView/Group.vue", selector: ".setting-item", hatch: false },
];

/** The static light fills a hovered/marked row is allowed to wear. */
const ROW_FILLS = ["$candy-pink-soft", "$mem-panel-static", "$mem-blush-soft-static"];

/**
 * The `<style>` blocks of an SFC, with comments removed.
 *
 * Scanning the whole file first looked fine and broke on the longest one: a
 * selector's preamble runs back to the previous `{`, `}` or `;`, and the last
 * statement of `<script setup>` carries no semicolon — so the first style rule
 * in SongItem.vue came out with the entire script tail glued to its selector
 * list and matched nothing.
 */
function styleSource(source: string): string {
  const styles = source.match(/<style[^>]*>([\s\S]*?)<\/style>/gi) ?? [];
  return styles
    .join("\n")
    .replace(/<\/?style[^>]*>/gi, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // `[^:]` guards `https://` — a line comment never follows a colon here.
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** The rule starting at `start`, from its selector to its matching brace. */
function blockFrom(clean: string, start: number, firstBrace: number): string | null {
  let depth = 0;
  for (let i = firstBrace; i < clean.length; i++) {
    if (clean[i] === "{") depth++;
    else if (clean[i] === "}" && --depth === 0) return clean.slice(start, i);
  }
  return null;
}

interface Rule {
  selectors: string[];
  body: string;
}

/**
 * Every rule in the source, nested ones included: for each opening brace, the
 * preamble back to the previous structural character is the selector list.
 *
 * Matching a selector with a line-anchored regex instead looked equivalent and
 * was not — `.sidebar-folder-header` is the second line of a two-selector list
 * higher up in the same file (`position: relative` for the drop markers), so a
 * regex found THAT rule and the check silently ran against four declarations
 * of unrelated CSS.
 */
function rules(clean: string): Rule[] {
  const found: Rule[] = [];

  for (let i = 0; i < clean.length; i++) {
    if (clean[i] !== "{") continue;

    let start = i - 1;
    while (start >= 0 && !"{};".includes(clean[start])) start--;

    const body = blockFrom(clean, i, i);
    if (!body) continue;

    found.push({
      selectors: clean
        .slice(start + 1, i)
        .split(",")
        .map(part => part.trim())
        .filter(Boolean),
      body,
    });
  }

  return found;
}

/**
 * A rule's own declarations, with every nested block removed.
 *
 * `rules()` hands back each body verbatim, nested rules included — which is
 * correct for finding rules but wrong for asking "what does THIS selector
 * declare". Without this, every ancestor inherits the text of everything below
 * it, and a check for two strings appearing together fires on the outermost
 * wrapper of the file.
 */
function ownDeclarations(body: string): string {
  let depth = 0;
  let own = "";

  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "{") {
      // The first brace opens this rule itself; deeper ones open nested rules.
      depth++;
      if (depth === 1) continue;
    } else if (char === "}") {
      depth--;
      continue;
    }
    if (depth <= 1) own += char;
  }

  return own;
}

/** The rules that style `selector` itself — its bare form and its pseudo states. */
function rulesFor(source: string, selector: string): Rule[] {
  return rules(styleSource(source)).filter(rule =>
    rule.selectors.some(part => part === selector || part.startsWith(`${selector}:`))
  );
}

/** Hover rules for a row: `.row:hover` at any level, or `&:hover` inside it. */
function hoverRulesFor(source: string, selector: string): Rule[] {
  return rulesFor(source, selector).flatMap(rule => [
    ...(rule.selectors.some(part => part.startsWith(`${selector}:hover`)) ? [rule] : []),
    ...rules(rule.body).filter(nested => nested.selectors.some(part => part.startsWith("&:hover"))),
  ]);
}

/** Every `:hover` rule in a file, whatever it is nested under. */
function hoverBodies(source: string): string[] {
  const clean = styleSource(source);
  const bodies: string[] = [];
  const opener = /[^\n{}]*:hover[^{}]*\{/g;

  for (let match = opener.exec(clean); match; match = opener.exec(clean)) {
    const body = blockFrom(clean, match.index, match.index + match[0].length - 1);
    if (body) bodies.push(body);
  }
  return bodies;
}

describe("list row hover", () => {
  // A source-scanning test goes silently GREEN when its parser breaks, so it
  // needs guards over its own inputs first (.claude/rules/testing.md).
  it("reads the row sources it claims to check", () => {
    for (const { file, selector } of ROWS) {
      expect(SOURCES[file], `${file} not readable`).toBeTruthy();

      // A row is a rule with real declarations in it, not the two-liner that
      // only sets `position` for the drop markers — hence the length floor.
      const bodies = rulesFor(SOURCES[file], selector).map(rule => rule.body);
      expect(bodies.length, `${selector} not found in ${file}`).toBeGreaterThan(0);
      expect(Math.max(...bodies.map(body => body.length))).toBeGreaterThan(200);

      expect(hoverRulesFor(SOURCES[file], selector).length, `${selector} has no hover rule`).toBeGreaterThan(0);
    }
  });

  it.each(ROWS)("$selector takes both halves from the shared mixins", ({ file, selector }) => {
    // The base half reserves the frame. Without it the row's content jumps by
    // the border width the moment the frame appears.
    const takesBase = rulesFor(SOURCES[file], selector).some(rule => /@include\s+candy-row-base/.test(rule.body));
    expect(takesBase, `${selector} does not @include candy-row-base`).toBe(true);

    const drawsFrame = hoverRulesFor(SOURCES[file], selector).some(rule =>
      /@include\s+candy-row-hover/.test(rule.body)
    );
    expect(drawsFrame, `${selector} hovers without @include candy-row-hover`).toBe(true);
  });

  // The regression the user reported: a sidebar row that fills on hover without
  // drawing the frame. Scoped to the sidebar by the row fills themselves, so a
  // non-row hover (the resize handle's deep pink, the play overlay's black
  // scrim) is out of scope without needing to be named in an exception list.
  it("never fills a sidebar row on hover without the frame", () => {
    const offenders: string[] = [];

    for (const [file, source] of Object.entries(SOURCES)) {
      if (!file.startsWith("/src/components/LeftSidebar/")) continue;

      for (const hover of hoverBodies(source)) {
        const fills = ROW_FILLS.some(fill => hover.includes(fill));
        if (fills && !/@include\s+candy-row-hover/.test(hover)) {
          offenders.push(`${file}: ${hover.split("\n")[0].trim()}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // Same idea as the header-action row census: a new row that uses either half
  // of the treatment has to be listed above, and is then checked for both.
  // (A row that hand-rolls the whole thing still escapes — the sidebar guard
  // above is what catches that where it has actually happened.)
  it("knows about every row that uses the shared treatment", () => {
    const found = Object.entries(SOURCES)
      .filter(([, source]) => /@include\s+candy-row-(base|hover)/.test(styleSource(source)))
      .map(([file]) => file)
      .sort();

    expect(found).toEqual([...new Set(ROWS.map(row => row.file))].sort());
  });
});

// ---------------------------------------------------------------------------
// The sidebar's plate anatomy (#378). Same reason as above, one design decision
// later: the rows became buttons, so what has to stay identical between them is
// the PLATE, not the hover fill. The three mixins live in _candy.scss.
//
// The hatch is the load-bearing part. It means "you can press this", which only
// works if pressable surfaces all wear it — and its stroke colour has to answer
// to the fill: `surface` (theme-aware) on the panel plate, `accent` (static ink)
// on the blush active state. An accent hatch on a panel plate is invisible in
// the dark theme, which is exactly the kind of miss that no screenshot of the
// light theme would ever show.
// ---------------------------------------------------------------------------
describe("sidebar plate anatomy", () => {
  it("reads the plate sources it claims to check", () => {
    for (const { file, selector } of PLATES) {
      expect(SOURCES[file], `${file} not readable`).toBeTruthy();
      expect(rulesFor(SOURCES[file], selector).length, `${selector} not found in ${file}`).toBeGreaterThan(0);
    }
  });

  it.each(PLATES)("$selector takes the shared plate", ({ file, selector }) => {
    const takesPlate = rulesFor(SOURCES[file], selector).some(rule => /@include\s+mem-row-plate\b/.test(rule.body));
    expect(takesPlate, `${selector} does not @include mem-row-plate`).toBe(true);
  });

  it("knows about every host of the plate mixins", () => {
    const found = Object.entries(SOURCES)
      .filter(([, source]) => /@include\s+mem-row-plate(-hover|-active)?\b/.test(styleSource(source)))
      .map(([file]) => file)
      .sort();

    expect(found).toEqual([...new Set(PLATES.map(plate => plate.file))].sort());
  });

  // THE HATCH IS A DECISION PER PLATE (#468), and the census records which way
  // each one went. Two directions to protect:
  //   · a sidebar plate must not quietly lose the texture — it is what tells
  //     its rows apart from the headings and dividers they sit among;
  //   · the charts row must not quietly regain it — at ~1900px the tile ran
  //     ~50 times across, straight through the title.
  it.each(PLATES)("$selector states its hatch answer once", ({ file, selector, hatch }) => {
    const own = rulesFor(SOURCES[file], selector)
      .map(rule => ownDeclarations(rule.body))
      .join("\n");

    // Assert the include is in the plate's OWN declarations before reading its
    // argument. Without this the regex below finds nothing on a plate that
    // moved its include into a nested rule, reports `optedOut: false`, and
    // passes for every `hatch: true` entry — green while checking nothing.
    expect(/@include\s+mem-row-plate\(/.test(own), `${selector} states no mem-row-plate of its own`).toBe(true);

    const optedOut = /@include\s+mem-row-plate\([^)]*\$hatch:\s*false/.test(own);
    expect(optedOut, `${selector} expected hatch=${hatch}`).toBe(!hatch);
  });

  // A plate that dropped the texture but hovered with it would GROW one under
  // the pointer. `mem-row-plate-hover` takes the same `$hatch` argument for
  // exactly this reason, and the two halves have to agree.
  //
  // Scanned over the plate's OWN rule body (nested rules included, which is how
  // `rulesFor` returns it), so the `&:hover` inside it is the one being read —
  // not some other plate's hover that happens to live in the same file.
  it.each(PLATES)("$selector hovers with the same hatch answer", ({ file, selector, hatch }) => {
    const body = rulesFor(SOURCES[file], selector)
      .map(rule => rule.body)
      .join("\n");
    if (!/@include\s+mem-row-plate-hover\b/.test(body)) return; // hover lives elsewhere

    const optedOut = /mem-row-plate-hover\([^)]*\$hatch:\s*false/.test(body);
    expect(optedOut, `${selector} hover disagrees with its plate (hatch=${hatch})`).toBe(!hatch);
  });

  // The pairing that cannot be seen in the light theme: a hatch whose stroke
  // colour does not match the fill it is drawn on.
  it("never hatches a static accent fill with the theme-aware token", () => {
    const offenders: string[] = [];

    for (const [file, source] of Object.entries(SOURCES)) {
      const clean = styleSource(source);
      // `mem-row-plate-active` sets the blush fill AND its accent hatch in one
      // mixin, so a call site that adds its own surface hatch next to it is
      // painting ink-on-panel over a static accent.
      for (const rule of rules(clean)) {
        // `-active` and `-tint` both set a STATIC accent fill together with the
        // accent hatch. A surface hatch stated next to either one paints
        // ink-on-panel over that accent — invisible in light, blank in dark.
        //
        // Checked against the rule's OWN declarations. `rules()` returns each
        // body with its nested rules still inside, so scanning the raw body
        // matched any ancestor that happened to contain both strings anywhere
        // below it — `.sidebar-library` and `.sidebar-folder` were both
        // reported that way, neither of which states either include itself.
        const own = ownDeclarations(rule.body);
        if (!/@include\s+mem-row-plate-(active|tint)/.test(own)) continue;
        if (/@include\s+mem-hatch(-ring)?\([^)]*surface/.test(own)) {
          offenders.push(`${file}: ${rule.selectors.join(", ")}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// TRACK ROW HOVER IS POINTER-ONLY (#457).
//
// `:hover` LATCHES on touch: after a tap it stays applied until the next tap
// lands elsewhere. The track rows' hover treatment is desktop pointer chrome —
// contrast fill, mirrored text, dimmed cover — so latched on a phone it turned
// the tapped row into a broken hybrid. Worst on the playing row: a width-keyed
// half-measure in app-grid.scss (`background-color: unset`) stripped its
// yellow fill while SongItem's hover text flip kept applying — white artist on
// the light memphis ground, measured rgb(255,255,255) over rgba(0,0,0,0).
//
// The rule this pins: in the track-row components, EVERY `:hover` rule lives
// inside `@media (hover: hover)`. A hover rule outside the gate is the
// regression, whatever it paints.
//
// The list is enumerated over the COMMON FEATURE — "a component that styles a
// track row on hover" — not over the broken spelling, because the instance that
// slips through is always the half-conforming one (CLAUDE.md, "die letzte
// Stelle"). That is how `TrackTitle.vue` got in: it paints no fill at all, it
// only straightens the tilted cover, so it was invisible to a search for the
// symptom — and latched on touch it left one row permanently out of its resting
// tilt.
// ---------------------------------------------------------------------------
const POINTER_GATED = [
  "/src/components/shared/SongItem.vue",
  "/src/components/shared/SongItem/TrackTitle.vue",
];

/** The source with every `@media (hover: hover) { … }` block removed. */
function stripPointerGates(clean: string): string {
  const opener = /@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{/;
  let out = clean;
  for (let match = opener.exec(out); match; match = opener.exec(out)) {
    let depth = 0;
    let end = -1;
    for (let i = match.index + match[0].length - 1; i < out.length; i++) {
      if (out[i] === "{") depth++;
      else if (out[i] === "}" && --depth === 0) {
        end = i;
        break;
      }
    }
    // An unclosed block means the brace matcher is broken — bail out and let
    // the leak check below fail loudly rather than silently stripping to EOF.
    if (end < 0) return out;
    out = out.slice(0, match.index) + out.slice(end + 1);
  }
  return out;
}

describe("track row hover is pointer-gated", () => {
  // Guards over the scan's own inputs first (.claude/rules/testing.md): a
  // parser that breaks must not go silently green.
  it("finds the gates and hover rules it claims to check", () => {
    for (const file of POINTER_GATED) {
      expect(SOURCES[file], `${file} not readable`).toBeTruthy();
      const clean = styleSource(SOURCES[file]);
      expect(/@media\s*\(\s*hover\s*:\s*hover\s*\)/.test(clean), `${file} has no pointer gate`).toBe(true);
      expect(/:hover/.test(clean), `${file} has no hover rules at all`).toBe(true);
      expect(stripPointerGates(clean).length, `${file}: stripping removed nothing`).toBeLessThan(clean.length);
    }

    // The gated SongItem block still carries the shared row treatment — the
    // gate must not have detached the census above from what it checks.
    expect(/@include\s+candy-row-hover/.test(styleSource(SOURCES[POINTER_GATED[0]]))).toBe(true);
  });

  it.each(POINTER_GATED)("%s declares no hover outside the gate", file => {
    const leaks = stripPointerGates(styleSource(SOURCES[file]))
      .split("\n")
      .filter(line => /:hover/.test(line))
      .map(line => line.trim());

    expect(leaks).toEqual([]);
  });

  // The half-measure the gate replaces: a width-keyed `:hover { background:
  // unset }` in app-grid.scss. It outranked the playing row's own fill and
  // suppressed only the fill, never the text flip — the broken hybrid above.
  //
  // The second clause is the trap the FIX itself walked into. The row's inlay
  // layers (guide band, perforation, ink stripe) were painted by selectors
  // carrying `:not(:hover)`, which is an ungated hover test: once the fill
  // above was pointer-gated, a latched tap would have failed that `:not` and
  // stripped the row's anatomy with nothing painting in its place. The
  // exclusion is a pointer-gated rule of its own now.
  it("keeps ungated hover tests out of the app-grid row layers", () => {
    const grid = readFileSync("src/assets/scss/Global/app-grid.scss", "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");

    // Input guards: the file still styles the rows, and still paints the
    // layers this rule is about.
    expect(grid).toMatch(/\.songlist-item/);
    expect(grid).toMatch(/\$songlist-band-w/);

    expect(grid).not.toMatch(/:hover[^{}]*\{[^{}]*background(-color)?\s*:\s*unset/);

    const ungated = stripPointerGates(grid)
      .split("\n")
      .filter(line => /:not\(\s*:hover\s*\)/.test(line))
      .map(line => line.trim());
    expect(ungated).toEqual([]);
  });
});
