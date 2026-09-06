// Shared parsing for the source-scanning anatomy tests (`topBarAnatomy`,
// `controlScale`).
//
// Not a test file — vitest collects `*.test.ts`, so this is only ever imported.
//
// ⚠️ A test that parses source does not fail when its parser breaks; it goes
// quietly green. Every caller therefore needs a guard over its own inputs
// ("the block was found", "the token list is not empty"), and these helpers
// are deliberately dumb enough to be read in one sitting.

/** A component's <style> content with comments removed. */
export function styleBlock(source: string): string {
  return source
    .slice(source.indexOf("<style"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/**
 * The body of `selector { … }`, matched only where the selector is followed by
 * its own `{` — so `.gsearch-input > #ginner > input {` cannot stand in for
 * `#ginner {`.
 *
 * `from` lets a caller walk every occurrence instead of just the first.
 */
export function block(css: string, selector: string, from = 0): { body: string; end: number } {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const opener = new RegExp(`(?:^|[\\s,>])${escaped}\\s*\\{`, "m").exec(css.slice(from));
  if (!opener) return { body: "", end: -1 };

  const start = css.indexOf("{", from + opener.index + opener[0].length - 1);
  let depth = 1;
  let i = start + 1;
  while (i < css.length && depth > 0) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
    i++;
  }
  return { body: css.slice(start + 1, i - 1), end: i };
}

/** Every `selector { … }` body in a stylesheet, in source order. */
export function blocks(css: string, selector: string): string[] {
  const out: string[] = [];
  let from = 0;
  for (;;) {
    const found = block(css, selector, from);
    if (found.end === -1) return out;
    out.push(found.body);
    from = found.end;
  }
}

/**
 * A block's own declarations plus those of its breakpoint overrides
 * (`@include allPhones { … }`), with child-element blocks removed.
 *
 * The breakpoints have to stay in: a control whose desktop size reads a token
 * and whose phone size reads a literal is exactly the drift these tests exist
 * to catch, and it hides in a nested block.
 */
export function ownDeclarations(css: string): string {
  let out = "";
  let pending = "";
  let i = 0;

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

      if (pending.trim().startsWith("@")) {
        out += "{" + ownDeclarations(css.slice(i + 1, j - 1)) + "}";
      } else {
        // Drop the child block together with the selector that opened it.
        out = out.slice(0, out.length - pending.length);
      }

      pending = "";
      i = j;
      continue;
    }

    out += char;
    pending += char;
    if (char === ";" || char === "}") pending = "";
    i++;
  }

  return out;
}

/**
 * The parts of a box shorthand (`margin: 1rem auto`), with `var(…)`/`calc(…)`
 * kept whole and `!important` dropped.
 *
 * The flag is stripped rather than counted, because a shorthand that carries it
 * has one token too many — and the callers below read the LEFT value by
 * position (1→all, 2/3→2nd, 4→4th). Five parts fell through as `null` and the
 * declaration left the census silently, which is the one failure mode a
 * source-scanning test cannot survive (see the ⚠️ in .claude/rules/testing.md).
 * Three censuses had grown their own copy of this parser and all three had the
 * hole; it lives here now so the next one inherits the fix instead of the bug.
 */
export function shorthandParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of value.replace(/!\s*important/gi, "").trim()) {
    if (char === "(" || char === "[") depth++;
    else if (char === ")" || char === "]") depth--;
    if (/\s/.test(char) && depth === 0) {
      if (current) parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current) parts.push(current);
  return parts;
}

/** The left value of a box shorthand: 1→all, 2/3→2nd, 4→4th. */
export function shorthandLeft(value: string): string | null {
  const parts = shorthandParts(value);
  if (parts.length === 1) return parts[0];
  if (parts.length === 2 || parts.length === 3) return parts[1];
  if (parts.length === 4) return parts[3];
  return null;
}

/**
 * Every rule body in a stylesheet, at ANY nesting depth, reduced to the
 * declarations it owns itself.
 *
 * ⚠️ NOT `/\{([^{}]*)\}/g`. That regex only ever sees the INNERMOST bodies:
 * measured over `src/**` + `*.vue`, 307 rule bodies declare a background and
 * 178 of them contain a child rule, so a census built on it is blind to more
 * than half of what it claims to sweep. The block this file was written for
 * was caught by it only because it happened to have no child rule.
 */
export function ruleBodies(css: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < css.length; i++) {
    if (css[i] !== "{") continue;

    let depth = 1;
    let j = i + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth++;
      else if (css[j] === "}") depth--;
      j++;
    }
    if (depth === 0) out.push(ownDeclarations(css.slice(i + 1, j - 1)));
  }
  return out;
}
