import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// THE BUTTON ROLES HOVER ONLY UNDER A POINTER (Global/_buttons.scss, "HOVER IS
// POINTER-ONLY").
//
// On touch `:hover` latches after a tap. The five roles painted their hover
// ungated — contrast fill, hover text, hover hatch, scale — so every tapped
// button stood as an ink plate (light theme) or a paper plate (dark theme)
// until the next tap landed elsewhere. The theme toggle was gated at its call
// site first (2026-10-17); this pins the same answer at the source.
//
// Two halves, because the fix has two:
//
// 1. The role mixins (and `candy-raised`, which gives three of them their
//    hover shadow) state every `:hover` inside `@media (hover: hover)` and
//    keep `:active` outside it — the press is what touch gets instead.
//
// 2. Every element that WEARS a role states its own hovers inside the gate
//    too. Collected over the common feature — "an element that wears a role",
//    by `@include btn-*` or by the global `btn-*` class in its template — not
//    over a list of call sites (CLAUDE.md, "die letzte Stelle"). The instance
//    that slips through is the half-conforming one: a call site restating only
//    the hover TEXT colour (the dimmed shuffle/repeat glyphs did) latches on
//    its own once the role is gated, and a tap then shows paper text on the
//    resting white plate — a glyph that vanished.
//
// Sources are read with `readFileSync`; the raw glob comes back empty for
// `.scss` (.claude/rules/testing.md).
// ---------------------------------------------------------------------------

const ROLES = ["btn-primary", "btn-action", "btn-quiet", "btn-pill", "btn-toggle-on"];
const WEARS_ROLE = /@include\s+btn-(?:action|primary|pill|quiet|toggle-on)\b/;
const ROLE_CLASS = /^btn-(?:action|primary|pill|quiet)$/;
const POINTER_GATE = /^@media[^{]*\(\s*hover\s*:\s*hover\s*\)/;

/**
 * Hovers on a role wearer that may stay ungated, each with its reason. Both
 * take the role BACK on a state that cannot be pressed: they restate the rest
 * look, so a latched tap shows nothing the rest state does not, and on touch
 * they are also what keeps the role's press off (the emulated `:hover` of a
 * tap outranks the role's `:active`). Gating them would make the dead key
 * press again.
 */
const ALLOWED: { file: string; selector: RegExp; why: string }[] = [
  {
    file: "src/views/LyricsView/Plugins/Find.vue",
    selector: /\.showError:hover$/,
    why: "the error message wears the plate but is not a button; restates its rest",
  },
  {
    file: "src/components/SearchView/BrowseArtists.vue",
    selector: /\.band-key\.off:hover$/,
    why: "an empty letter is shown but not pressable; restates its rest",
  },
];

/** Comments out, interpolation flattened — `#{…}` braces are not blocks. */
function code(source: string): string {
  let out = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  while (/#\{[^{}]*\}/.test(out)) out = out.replace(/#\{[^{}]*\}/g, "_i_");
  return out;
}

/** The source with every `@media (hover: hover) { … }` block removed. */
function stripPointerGates(clean: string): string {
  const opener = /@media[^{]*\(\s*hover\s*:\s*hover\s*\)[^{]*\{/;
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
    // Unclosed: the matcher is broken. Stop here, so the checks below see a
    // hover that is still there and fail loudly instead of passing.
    if (end < 0) return out;
    out = out.slice(0, match.index) + out.slice(end + 1);
  }
  return out;
}

function mixin(css: string, name: string): string {
  const start = css.indexOf(`@mixin ${name}(`);
  const next = css.indexOf("\n@mixin ", start + 1);
  return start < 0 ? "" : css.slice(start, next === -1 ? undefined : next);
}

const BUTTONS = code(readFileSync("src/assets/scss/Global/_buttons.scss", "utf8"));
const CANDY = code(readFileSync("src/assets/scss/_candy.scss", "utf8"));

describe("the roles gate their hover at the source", () => {
  it.each(ROLES)("%s states its hover inside the pointer gate", role => {
    const body = mixin(BUTTONS, role);
    expect(body, `@mixin ${role} not found`).not.toBe("");
    // Self-check: the hover is still THERE, only gated.
    expect(body).toMatch(/@media \(hover: hover\) \{\s*&:hover \{/);
    expect(stripPointerGates(body)).not.toMatch(/:hover/);
  });

  it.each(ROLES)("%s keeps its press ungated, for touch", role => {
    expect(stripPointerGates(mixin(BUTTONS, role))).toMatch(/&:active \{\s*transform: scale\(0\.98\);/);
  });

  it("candy-raised, the hover shadow of three roles, is gated the same way", () => {
    const body = mixin(CANDY, "candy-raised");
    expect(body).toMatch(/@media \(hover: hover\) \{\s*&:hover \{\s*@include candy-shadow/);
    const ungated = stripPointerGates(body);
    expect(ungated).not.toMatch(/:hover/);
    expect(ungated).toMatch(/@if \$press \{\s*&:active \{/);
  });

  it("nothing in the roles file hovers outside the gate", () => {
    // The whole file, so the next role written there is covered too.
    expect(BUTTONS).toMatch(/:hover/);
    expect(stripPointerGates(BUTTONS)).not.toMatch(/:hover/);
  });
});

// ---------------------------------------------------------------------------
// The call sites. A small SCSS flattener: nested rules are resolved against
// their parents (`&` replaced, otherwise a descendant), `@media (hover: hover)`
// marks what it contains as gated, other at-rules (breakpoint mixins, `@if`)
// are transparent, and mixin/keyframe bodies are skipped — they are not rules.
// ---------------------------------------------------------------------------
interface Rule {
  selectors: string[];
  own: string;
  gated: boolean;
}

/** A selector list split on its top-level commas (`:not(.a, .b)` stays whole). */
function splitList(header: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of header) {
    if (char === "(") depth++;
    else if (char === ")") depth--;
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else current += char;
  }
  parts.push(current);
  return parts.map(part => part.replace(/\s+/g, " ").trim()).filter(Boolean);
}

function resolve(header: string, parents: string[]): string[] {
  return splitList(header).flatMap(part =>
    parents.map(parent =>
      (part.includes("&") ? part.replace(/&/g, parent) : parent ? `${parent} ${part}` : part).trim()
    )
  );
}

function flatten(css: string, parents: string[] = [""], gated = false, out: Rule[] = []): Rule[] {
  let own = "";
  let start = 0;
  let i = 0;
  while (i < css.length) {
    const char = css[i];
    if (char === "{") {
      const header = css.slice(start, i).trim();
      let depth = 1;
      let j = i + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === "{") depth++;
        else if (css[j] === "}") depth--;
        j++;
      }
      const inner = css.slice(i + 1, j - 1);
      if (/^@(?:mixin|function|keyframes|font-face)\b/.test(header)) {
        // not rules
      } else if (header.startsWith("@")) {
        flatten(inner, parents, gated || POINTER_GATE.test(header), out);
      } else {
        flatten(inner, resolve(header, parents), gated, out);
      }
      i = j;
      start = j;
      continue;
    }
    if (char === ";") {
      own += css.slice(start, i + 1);
      start = i + 1;
    }
    i++;
  }
  own += css.slice(start);
  out.push({ selectors: parents, own, gated });
  return out;
}

/** The compound selectors of a complex selector (combinators dropped). */
function compounds(selector: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of selector) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (depth === 0 && /[\s>+~]/.test(char)) {
      if (current) out.push(current);
      current = "";
    } else current += char;
  }
  if (current) out.push(current);
  return out;
}

/** A compound with every functional pseudo-class (`:not(…)`, `:is(…)`) cut out. */
function withoutPseudoCalls(compound: string): string {
  let out = compound;
  for (let match = /:{1,2}[\w-]+\(/.exec(out); match; match = /:{1,2}[\w-]+\(/.exec(out)) {
    let depth = 0;
    let end = out.length;
    for (let i = match.index + match[0].length - 1; i < out.length; i++) {
      if (out[i] === "(") depth++;
      else if (out[i] === ")" && --depth === 0) {
        end = i + 1;
        break;
      }
    }
    out = out.slice(0, match.index) + out.slice(end);
  }
  return out;
}

interface Subject {
  tag: string;
  classes: string[];
}

function subject(compound: string): Subject {
  const bare = withoutPseudoCalls(compound)
    .replace(/\[[^\]]*\]/g, "")
    .replace(/::?[\w-]+/g, "");
  return {
    tag: bare.match(/^[a-zA-Z][\w-]*/)?.[0] ?? "",
    classes: [...bare.matchAll(/\.([\w-]+)/g)].map(m => m[1]),
  };
}

/** `:hover` on this compound — `:not(:hover)` is a different question. */
const hovers = (compound: string) => /:hover\b/.test(withoutPseudoCalls(compound));

function wears(wearer: Subject, element: Subject): boolean {
  if (!wearer.tag && wearer.classes.length === 0) return false;
  if (wearer.tag && wearer.tag !== element.tag) return false;
  return wearer.classes.every(name => element.classes.includes(name));
}

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "node_modules" && entry !== "__tests__") found.push(...sourceFiles(path));
    } else if (/\.(scss|vue)$/.test(entry)) {
      found.push(path.replace(/\\/g, "/"));
    }
  }
  return found;
}

function styles(file: string, source: string): string {
  if (!file.endsWith(".vue")) return source;
  return [...source.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join("\n");
}

/** Elements that wear a role through the global class (`class="save btn-pill"`). */
function templateWearers(source: string): Subject[] {
  const template = source.match(/<template>([\s\S]*)<\/template>/)?.[1] ?? "";
  const found: Subject[] = [];
  for (const [, list] of template.matchAll(/\sclass="([^"]*)"/g)) {
    const names = list.split(/\s+/).filter(Boolean);
    if (names.some(name => ROLE_CLASS.test(name))) {
      for (const name of names) found.push({ tag: "", classes: [name] });
    }
  }
  return found;
}

interface Found {
  file: string;
  selector: string;
  gated: boolean;
  pair: boolean;
}

/** Every hover rule on a role wearer, gated or not, across the app — one entry per occurrence. */
function wearerHovers(): { files: number; wearers: number; found: Found[] } {
  const files = sourceFiles("src");
  let wearerCount = 0;
  const found: Found[] = [];

  for (const file of files) {
    // The definitions are checked above; their bodies are mixins, not rules.
    if (/\/_(buttons|candy)\.scss$/.test(file)) continue;
    const source = readFileSync(file, "utf8");
    const rules = flatten(code(styles(file, source)));

    const wearers: Subject[] = [
      ...rules
        .filter(rule => WEARS_ROLE.test(rule.own))
        .flatMap(rule =>
          rule.selectors.map(selector => {
            const parts = compounds(selector);
            return subject(parts[parts.length - 1] ?? "");
          })
        ),
      ...(file.endsWith(".vue") ? templateWearers(source) : []),
    ];
    wearerCount += wearers.length;
    if (wearers.length === 0) continue;

    for (const rule of rules) {
      if (!rule.own.trim()) continue;
      for (const selector of rule.selectors) {
        const onWearer = compounds(selector).some(
          compound => hovers(compound) && wearers.some(wearer => wears(wearer, subject(compound)))
        );
        if (!onWearer) continue;
        // `X, X:hover { … }`: the hover restates its own rest state, so a
        // latched tap cannot show anything the rest state does not.
        const pair = rule.selectors.includes(selector.replace(/:hover\b/g, ""));
        found.push({ file, selector, gated: rule.gated, pair });
      }
    }
  }
  return { files: files.length, wearers: wearerCount, found };
}

describe("role wearers gate their own hovers too", () => {
  const { files, wearers, found } = wearerHovers();
  const isAllowed = (hit: Found) => ALLOWED.some(a => a.file === hit.file && a.selector.test(hit.selector));

  it("finds the files, the wearers and the hovers it claims to check", () => {
    // A source-scanning test goes silently green when its parser breaks
    // (.claude/rules/testing.md), so it proves it can see each kind of case.
    expect(files).toBeGreaterThan(100);
    expect(wearers).toBeGreaterThan(40);
    const has = (file: string, tail: RegExp) => found.find(hit => hit.file === file && tail.test(hit.selector));

    // A gated hover on an `@include` wearer…
    expect(has("src/components/nav/ThemeToggle.vue", /^\.theme-toggle:hover$/)?.gated).toBe(true);
    // …one on a wearer inside a selector list with `:not()`…
    expect(has("src/components/BottomBar/Right.vue", /button\.aux\.aux-off:hover$/)?.gated).toBe(true);
    // …one on a template-class wearer…
    expect(has("src/components/modals/ConfirmModal.vue", /\.cancel:hover$/)).toBeTruthy();
    // …and an exempt pair.
    expect(has("src/assets/scss/Global/search-tabheaders.scss", /\.activetab:hover$/)?.pair).toBe(true);
  });

  it("states no hover on a role wearer outside the pointer gate", () => {
    const offenders = found
      .filter(hit => !hit.gated && !hit.pair && !isAllowed(hit))
      .map(hit => `${hit.file} → ${hit.selector}`);
    expect([...new Set(offenders)]).toEqual([]);
  });

  it("keeps no stale exceptions", () => {
    // An entry whose hover was gated or removed must leave the list, or it
    // would wave the next one through under its name.
    for (const entry of ALLOWED) {
      const hit = found.find(h => h.file === entry.file && entry.selector.test(h.selector) && !h.gated);
      expect(hit, `${entry.file} ${entry.selector} — ${entry.why}`).toBeTruthy();
    }
  });
});
