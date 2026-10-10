import { readFileSync, readdirSync, statSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { namedRules } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A PRESSABLE PLATE TAKES A ROLE — it is never drawn by hand.
//
// Every pressable thing in Memphis has five traits, and a role brings all five
// (styling.md, "Neues Bedienelement?"): offset shadow, press, hatch, the shared
// hover token, a 44px target. Whoever writes the frame and the fill by hand
// gets exactly the half they had in mind — and the shadow is the half nobody
// misses while writing, because nothing on the screen in front of them is
// missing it yet.
//
// Real case (#423): the genre chips under "Never played" carried `border` +
// `background-color` + `cursor: pointer` by hand and stood as the only plates
// in their row WITHOUT a shadow, 36 instead of 44px, no hatch, no press —
// right under two stickers that all cast one. The user saw it at once; no test
// did. The rule already existed in prose, and prose did not hold it.
//
// So this census looks for the SHAPE of that bug in every style block of the
// app: something pressable (`cursor: pointer`, or a rule on a `button`) that
// draws a visible frame and a fill, while the block takes no role and no shadow
// at rest (a role that only arrives in `&:hover` does not count). The fill may
// sit in a state — a framed button that only fills under the pointer (the
// toast's "Undo") is the same plate, it just shows its fill later.
//
// What it does NOT see: a filled button with no frame at all (the pair page's
// "Go to login", the folder search's "Load more"). That is the same drift one
// step further along, but a different shape, with its own exceptions (scrims
// over artwork, the sidebar folder head's `--row-fill`) — tracked in #424.
//
// ⚠️ A source-scanning test goes quietly GREEN when its parser breaks
// (.claude/rules/testing.md), so the census is guarded three ways: the scan
// covers the app, it finds the roles' own plates (which draw exactly this shape
// and are exempt only by their shadow), and it flags the pre-#423 chip.
// ---------------------------------------------------------------------------

// Vue components through Vite, so the scan sees exactly what the build sees.
// Stylesheets off disk: `as: "raw"` returns an EMPTY string for `.scss` under
// test (.claude/rules/testing.md).
const VUE = import.meta.glob("/src/**/*.vue", { as: "raw", eager: true }) as Record<string, string>;

function scssFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = `${dir}/${entry}`;
    if (statSync(path).isDirectory()) files.push(...scssFiles(path));
    else if (entry.endsWith(".scss")) files.push(path);
  }
  return files;
}

/** Comments out — `[^:]` keeps `https://` inside a `url()` intact. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Every `<style>` block of an SFC — not "everything after the first `<style`":
 * an SFC whose template comes last would hand its `{{ }}` to the brace walker.
 */
function styleOf(sfc: string): string {
  const styles = sfc.match(/<style[^>]*>[\s\S]*?<\/style>/gi) ?? [];
  return stripComments(styles.join("\n").replace(/<\/?style[^>]*>/gi, "\n"));
}

const SOURCES: [string, string][] = [
  ...Object.entries(VUE).map(([path, sfc]): [string, string] => [path.slice(1), styleOf(sfc)]),
  ...scssFiles("src").map((path): [string, string] => [path, stripComments(readFileSync(path, "utf8"))]),
];

/** Every value a block gives `property`, `!important` dropped. */
function values(css: string, property: string): string[] {
  const declaration = new RegExp(`(?:^|[;{\\s])${property}\\s*:\\s*([^;{}]+)`, "g");
  return [...css.matchAll(declaration)].map(match =>
    match[1].replace(/!\s*important/i, "").trim().toLowerCase()
  );
}

/**
 * `candy-box` IS a frame and a fill (Global/_candy.scss) — and nothing else: no
 * shadow, no press. So it counts as drawing the plate, never as a role.
 */
const BOX = /@include\s+candy-box\b/;

/** A frame you can see: not `none`/`0`, and not the reserved transparent one. */
const framed = (css: string) =>
  BOX.test(css) ||
  // The longhands too: a frame spelled `border-width` + `border-color` is the
  // same frame, and a census that only knows the shorthand is one rewrite away
  // from blind.
  values(css, "border(?:-width|-color)?").some(
    value => !/^(none|0|0px|unset|initial|inherit)$/.test(value) && !value.includes("transparent")
  );

/** A fill you can see — `background` or `background-color`, never `-image`. */
const filled = (css: string) =>
  BOX.test(css) ||
  values(css, "background(?:-color)?").some(value => !/^(none|transparent|unset|initial|inherit|0)$/.test(value));

/**
 * Pressable: says so with its cursor, or is a rule on a `button` — which gets
 * its pointer from the global base (Global/basic.scss) and never restates it.
 */
const pressable = (own: string, selector: string) =>
  values(own, "cursor").includes("pointer") ||
  selector.split(",").some(part => /(?:^|[\s>+~])button\b/.test(part.trim()));

/**
 * A role, or one of the mixins a role is built from, or a shadow stated by
 * hand. `box-shadow: none` is NOT a shadow — a plate that switches its shadow
 * off is exactly the flat plate this census is about. (`candy-box` is not in
 * here — see BOX.)
 *
 * The roles are NAMED, not `btn-[\w-]+`: that also matched `btn-pop`, the
 * arrival animation every role includes, so the mutation probe that took the
 * shadow out of `btn-pill` stayed green. Same for `mem-row-plate` without its
 * `-hover`/`-tint`/`-active` halves: none of those paints a resting shadow.
 */
const ROLE_OR_SHADOW =
  /@include\s+(?:btn-(?:primary|action|quiet|pill|toggle-on)|candy-raised|candy-shadow|mem-row-plate(?!-)|candy-row-base|mem-sticker)\b|mem-shadow\(|box-shadow\s*:\s*(?!none\b)[^;\s]/;

interface Plate {
  /** `file :: outer » inner` — the key ALLOWED is written in. */
  key: string;
  exempt: boolean;
}

/** Every block that draws a pressable plate, whether it has a role or not. */
function platesIn(file: string, css: string): Plate[] {
  return namedRules(css)
    .filter(rule => !rule.selector.startsWith("@") || rule.selector.startsWith("@mixin"))
    .filter(rule => pressable(rule.own, rule.selector) && framed(rule.own) && filled(rule.body))
    .map(rule => ({
      key: `${file} :: ${[...rule.parents, rule.selector].join(" » ")}`,
      // The block's OWN declarations (breakpoint overrides included), not its
      // nested states: a role that only arrives in `&:hover` leaves the plate
      // flat at rest — the half-converted block the probe let through when
      // this read `rule.body`.
      exempt: ROLE_OR_SHADOW.test(rule.own),
    }));
}

const PLATES = SOURCES.flatMap(([file, css]) => platesIn(file, css));

/**
 * Hand-drawn on purpose — each with the reason it is not a role. Shrinks; an
 * addition needs a reason a reviewer would accept, not "it was like that".
 */
const ALLOWED: Record<string, string> = {
  "src/assets/scss/ProgressBar.scss :: input[type='range']":
    "a slider rail: dragged, not pressed — the thumb is the handle, and the rail's geometry has one source (`range-geometry`)",
};

describe("hand-drawn pressable plates", () => {
  it("scans the whole app", () => {
    expect(Object.keys(VUE).length, "the .vue glob came back short").toBeGreaterThan(100);
    expect(SOURCES.length, "the source list came back short").toBeGreaterThan(100);
    // Real style text came back, not 190 empty strings from a broken `styleOf`
    // (45 files stated a pointer when this was written).
    expect(SOURCES.filter(([, css]) => /cursor\s*:\s*pointer/.test(css)).length).toBeGreaterThan(30);
  });

  it("finds the roles' own plates, and lets them through for their shadow", () => {
    // The roles draw exactly the shape under test — frame, fill, pointer — and
    // are exempt only because they carry the shadow. If the detector cannot
    // see THEM, it cannot see anything.
    expect(PLATES.length, "the census found no plates at all").toBeGreaterThan(0);
    for (const role of ["@mixin btn-pill(", "@mixin btn-primary("]) {
      const found = PLATES.find(plate => plate.key.includes(role));
      expect(found, `${role} not detected as a plate — the parser is blind`).toBeTruthy();
      expect(found?.exempt, `${role} not recognised as carrying a shadow`).toBe(true);
    }
    expect(
      PLATES.some(plate => plate.key.endsWith("Switch.vue :: .switch")),
      "the settings switch not detected"
    ).toBe(true);
  });

  it("flags the genre chip as it was before #423", () => {
    // The real block, verbatim, from the commit before the fix.
    const before = `.home-rows {
      .row-chip {
        min-height: 2.25rem;
        padding: 0 0.9rem;
        border-radius: $candy-radius-pill;
        border: $mem-ring-w solid $mem-frame;
        background-color: $mem-panel;
        color: $candy-text;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;

        &[aria-pressed='true'] {
          background-color: $mem-yellow;
          border-color: $mem-ink;
          color: $mem-ink;
        }
      }
    }`;
    expect(platesIn("fixture", before)).toEqual([{ key: "fixture :: .home-rows » .row-chip", exempt: false }]);

    // …and lets the fixed one through: the role carries what was missing.
    const after = `.row-chip {
      @include btn-pill($radius: $candy-radius-pill, $fill: $mem-panel);
      color: $candy-text;
    }`;
    expect(platesIn("fixture", after).filter(plate => !plate.exempt)).toEqual([]);
  });

  it("no pressable plate is drawn by hand", () => {
    const offenders = PLATES.filter(plate => !plate.exempt && !(plate.key in ALLOWED)).map(plate => plate.key);
    expect(
      offenders,
      "frame + fill + pointer by hand, with no role and no shadow — take a role from Global/_buttons.scss " +
        '(styling.md, "Neues Bedienelement?"), or add the block to ALLOWED with the reason it cannot be one'
    ).toEqual([]);
  });

  it("every allowed exception still exists, with a reason", () => {
    // An entry for a block that was renamed or converted is dead weight — and
    // the next block to land on that key would pass unseen.
    const keys = PLATES.filter(plate => !plate.exempt).map(plate => plate.key);
    expect(Object.keys(ALLOWED).filter(key => !keys.includes(key))).toEqual([]);
    for (const [key, reason] of Object.entries(ALLOWED)) {
      expect(reason.length, `${key} is allowed without a reason`).toBeGreaterThan(20);
    }
  });
});

// ---------------------------------------------------------------------------
// FILLED WITHOUT A FRAME (#424).
//
// The census above is blind to a pressable that is filled but has no frame: the
// pair page's "Go to login" (green, no frame, no shadow), the folder search's
// "Load more", the Devices "Play here". Same drift — a plate with no role and no
// shadow — one shape further along. A FILL on its own is the plate here, so this
// checks the block's own declarations: pressable, painting a fill, no frame of
// its own, and no role or shadow.
//
// Exceptions here are not "hand-drawn on purpose" but a different kind of
// surface: a scrim over artwork (a dimmer, not a plate) and a plate's head whose
// frame belongs to the parent box. Each says so in its reason.
// ---------------------------------------------------------------------------
function flatFillsIn(file: string, css: string): Plate[] {
  return namedRules(css)
    .filter(rule => !rule.selector.startsWith("@") || rule.selector.startsWith("@mixin"))
    .filter(rule => pressable(rule.own, rule.selector) && !framed(rule.own) && filled(rule.own))
    .map(rule => ({
      key: `${file} :: ${[...rule.parents, rule.selector].join(" » ")}`,
      exempt: ROLE_OR_SHADOW.test(rule.own),
    }));
}

const FLAT_FILLS = SOURCES.flatMap(([file, css]) => flatFillsIn(file, css));

const FLAT_ALLOWED: Record<string, string> = {};

describe("filled pressables without a frame (#424)", () => {
  it("finds the flat fills it claims to check", () => {
    expect(FLAT_FILLS.length, "the flat-fill census found nothing").toBeGreaterThan(0);
  });

  it("no pressable is filled without a frame or a role", () => {
    const offenders = FLAT_FILLS.filter(plate => !plate.exempt && !(plate.key in FLAT_ALLOWED)).map(plate => plate.key);
    expect(
      offenders,
      "a fill with no frame and no role — take a role (styling.md), or add it to FLAT_ALLOWED with the reason"
    ).toEqual([]);
  });

  it("every flat exception still exists, with a reason", () => {
    const keys = FLAT_FILLS.filter(plate => !plate.exempt).map(plate => plate.key);
    expect(Object.keys(FLAT_ALLOWED).filter(key => !keys.includes(key))).toEqual([]);
    for (const [key, reason] of Object.entries(FLAT_ALLOWED)) {
      expect(reason.length, `${key} is allowed without a reason`).toBeGreaterThan(20);
    }
  });
});
