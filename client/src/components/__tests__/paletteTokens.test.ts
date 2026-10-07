import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// THE PALETTE IS A SET OF RUNTIME PROPERTIES (#395).
//
// Ink, paper and every accent used to be compiled in, and `mem-pastel()` mixed
// the tints in Sass — a second colour scheme would have needed a second build.
// Now `$mem-<role>` is `var(--mem-<role>)`, :root emits the literals once, and
// the tints are mixed by the browser (`color-mix`).
//
// The trap this census guards is silent: a Sass colour function on a var().
// `mix()` fails the build, but `rgba($mem-teal, 0.5)` does NOT — Sass passes it
// through as plain CSS, `rgba(var(--mem-teal), 0.5)`, which the browser drops.
// No error, no lint, no red test: one colour simply goes missing. Use
// `mem-alpha()` / `mem-pastel()`, or a `-static` twin where Sass really needs
// a literal.
//
// Read with `readFileSync` (see testing.md: a raw glob of `.scss` comes back
// empty under Vitest).
// ---------------------------------------------------------------------------

function sources(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(path, ext));
    } else if (ext.test(name)) out.push(path);
  }
  return out;
}

const CANDY_PATH = "src/assets/scss/_candy.scss";
const CANDY = readFileSync(CANDY_PATH, "utf-8");
const INDEX = readFileSync("src/assets/scss/Global/index.scss", "utf-8");

/** The roles of the literal map, in order: `"ink": $mem-ink,` → `ink`. */
function paletteRoles(): string[] {
  const start = CANDY.indexOf("$mem-palette-static: (");
  expect(start, "$mem-palette-static not found in _candy.scss").toBeGreaterThan(-1);
  // Up to the map's own `) !default;` — a `)` inside a comment must not end it.
  const body = CANDY.slice(start, CANDY.indexOf(") !default;", start));
  return [...body.matchAll(/"([a-z-]+)":\s*\$mem-[a-z-]+/g)].map((m) => m[1]);
}

/**
 * Line comments out, so a `// rgba($x)` in prose does not count. Only a `//`
 * that is not part of a URL (`http://`) starts one — otherwise the rest of a
 * line after a URL would never be scanned.
 */
function stripComment(line: string): string {
  return line.replace(/(^|[^:])\/\/.*$/, "$1");
}

/** A comment-free line list. */
function codeLines(path: string): [number, string][] {
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((line, i) => [i + 1, stripComment(line)] as [number, string]);
}

/** Sass colour functions (global and `color.*` module forms). `color-mix` is CSS and not one of them. */
const COLOUR_CALL =
  /(?<![\w-])(rgba?|mix|lighten|darken|transparentize|opacify|fade-in|fade-out|saturate|desaturate|adjust-hue|complement|scale-color|adjust-color|change-color|color\.[a-z-]+)\(/g;

/** A variable Sass may run a colour function on: a literal by construction. */
const isLiteralVar = (name: string) => /-static$/.test(name) || /^mem-dark-/.test(name) || /^brand-/.test(name);

/** `path:line: call` for every colour function whose arguments mention a non-literal variable. */
function colourCallsInText(text: string, path: string): string[] {
  const code = text.split("\n").map(stripComment).join("\n");
  const hits: string[] = [];
  for (const m of code.matchAll(COLOUR_CALL)) {
    // Balanced scan to the closing paren: the arguments may nest (map-get, #{}).
    const open = m.index! + m[0].length;
    let depth = 1;
    let end = open;
    while (end < code.length && depth > 0) {
      if (code[end] === "(") depth++;
      else if (code[end] === ")") depth--;
      end++;
    }
    const args = code.slice(open, end - 1);
    // `$name` that is not a keyword-argument label (`$lightness: 5%`).
    const vars = [...args.matchAll(/\$([a-z0-9-]+)(?!\s*:)/g)].map((v) => v[1]);
    if (vars.some((v) => !isLiteralVar(v))) {
      const line = code.slice(0, m.index).split("\n").length;
      hits.push(`${path}:${line}: ${m[0]}${args.trim()})`);
    }
  }
  return hits;
}

function colourCallsOnVars(paths: string[]): string[] {
  return paths.flatMap((path) => colourCallsInText(readFileSync(path, "utf-8"), path));
}

describe("palette roles are runtime properties (#395)", () => {
  it("knows every role of the palette", () => {
    expect(paletteRoles()).toEqual([
      "ink",
      "paper",
      "teal",
      "yellow",
      "coral",
      "lavender",
      "pink",
      "blue",
      "kraft",
      "lime",
      "gold",
      "sea",
      "orchid",
      "home",
      "muted",
      "blush",
      "blush-soft",
    ]);
  });

  it("points every $mem-<role> at its property", () => {
    for (const role of paletteRoles()) {
      expect(CANDY, `$mem-${role} is not var(--mem-${role})`).toMatch(
        new RegExp(`^\\$mem-${role}: var\\(--mem-${role}\\);$`, "m"),
      );
    }
  });

  it("keeps the literal map behind !default, or a re-import captures the var()", () => {
    // Same failure as the -static twins: without !default the second import of
    // _candy.scss would rebuild the map from the var()s and emit
    // `--mem-teal: var(--mem-teal)` on :root — a self-reference, i.e. no colour.
    expect(CANDY).toMatch(/\$mem-palette-static: \([\s\S]*?\) !default;/);
  });

  it("emits the properties on :root from the map", () => {
    const root = INDEX.slice(INDEX.indexOf(":root {"), INDEX.indexOf("body.theme-dark {"));
    expect(root).toMatch(/@each \$role, \$value in \$mem-palette-static \{\s*--mem-#\{\$role\}: #\{\$value\};/);
  });

  it("mixes tints and alphas in the browser, not in Sass", () => {
    const fn = (name: string) => {
      const at = CANDY.indexOf(`@function ${name}(`);
      expect(at, `@function ${name} not found`).toBeGreaterThan(-1);
      return CANDY.slice(at, CANDY.indexOf("}", at));
    };
    expect(fn("mem-pastel")).toContain("color-mix(in srgb,");
    expect(fn("mem-alpha")).toContain("color-mix(in srgb,");
  });

  it("runs no Sass colour function on a var()", () => {
    // Every variable anywhere in a colour function's arguments must be a
    // literal: a -static twin, the dark-mode literals, or the brand colours.
    // Anything else is (or aliases, or is looked up from a map of) a palette
    // role — `rgba(map-get($mem-entities, "album"), .5)` and
    // `rgba(#{$mem-coral}, .4)` are the same silent drop as `rgba($mem-coral, .4)`.
    const hits = colourCallsOnVars(sources("src", /\.(vue|scss)$/));
    expect(hits).toEqual([]);
  });

  it("the colour-call scanner sees every form of the trap", () => {
    // Guard over the parser itself (testing.md): a scanner that silently
    // stopped matching would leave the census above green.
    const sample = [
      "a { color: rgba($mem-teal, 0.5); }",
      'b { color: rgba(map-get($mem-entities, "album"), 0.5); }',
      "c { color: rgba(#{$mem-coral}, .4); }",
      "d { color: mix(#fff, $mem-teal); }",
      "e { color: color.adjust($mem-teal, $lightness: 5%); }",
      "f { background: url(http://x.y/z.png); color: rgba($mem-pink, .3); }",
      "g { color: rgba($mem-dark-ground, 0.92); }", // literal: allowed
      "h { color: color-mix(in srgb, #{$mem-teal} 55%, transparent); }", // browser mix: allowed
    ].join("\n");
    expect(colourCallsInText(sample, "sample").map((h) => h.split(":")[1])).toEqual(["1", "2", "3", "4", "5", "6"]);
  });

  it("colours set from script follow the palette too", () => {
    // `MEMPHIS.<role>` is the JSON literal — it would stay Memphis under any
    // other scheme. Script-set colours read `var(--mem-<role>)` instead. The
    // one exception draws into an SVG attribute (the pairing QR code), where a
    // var() does not resolve; it sits on a white panel in every scheme.
    const allowed = new Set(["src/components/modals/settings/custom/Pairing.vue"]);
    const hits: string[] = [];
    for (const path of sources("src", /\.(vue|ts)$/)) {
      if (allowed.has(path)) continue;
      for (const [n, line] of codeLines(path)) {
        if (/\bMEMPHIS\.[a-zA-Z]+/.test(line)) hits.push(`${path}:${n}: ${line.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
