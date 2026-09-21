import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// THE MEMPHIS FORM IS A SET OF RUNTIME TOKENS (#198).
//
// Hard offset shadows, the press into them, the corner radii and the two
// textures read `var(--shape-*, <memphis value>)`. The fallback IS the design,
// so Memphis sets nothing and computes what it always did; a second theme
// reshapes the app by setting the properties on `body`.
//
// That only holds while nobody writes the shape by hand again. A single
// `box-shadow: 3px 3px 0 var(--mem-shadow)` in a component keeps its hard
// offset in every theme — invisible in Memphis, a stray ink edge in any other.
// This census stops exactly that form. It found 13 of them when it was written.
//
// Read with `readFileSync` (see testing.md: a raw glob of `.scss` comes back
// empty under Vitest).
// ---------------------------------------------------------------------------

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "__tests__") out.push(...sources(path));
    } else if (/\.(vue|scss)$/.test(name)) out.push(path);
  }
  return out;
}

const FILES = sources("src");
const CANDY = "src/assets/scss/_candy.scss";
const STREAM = "src/assets/scss/Global/_theme-stream.scss";

/** `line: text` for every line matching `re`, outside the one owner file. */
function offenders(re: RegExp, owner = CANDY): string[] {
  const hits: string[] = [];
  for (const file of FILES) {
    if (file.split("\\").join("/") === owner) continue;
    readFileSync(file, "utf-8")
      .split("\n")
      .forEach((line, i) => {
        if (re.test(line) && !line.trim().startsWith("//")) hits.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

describe("shape tokens", () => {
  it("no hard offset shadow is written by hand — mem-shadow() owns them", () => {
    expect(offenders(/box-shadow:[^;]*-?\d+(\.\d+)?px\s+-?\d+(\.\d+)?px\s+0\s+(var\(--mem-shadow\)|\$mem-(ink|line))/)).toEqual([]);
  });

  it("no press is written as a literal translate — mem-press() owns it", () => {
    expect(offenders(/transform:\s*translate\(\s*\d+px\s*,\s*\d+px\s*\)/)).toEqual([]);
  });

  it("no corner uses the Memphis radius as a literal", () => {
    expect(offenders(/border-radius:\s*(14|10)px\b/)).toEqual([]);
  });

  it("the radius tokens are runtime tokens with the Memphis value as fallback", () => {
    const candy = readFileSync(CANDY, "utf-8");
    expect(candy).toMatch(/\$candy-radius:\s*var\(--shape-radius,\s*#\{\$candy-radius-static\}\)/);
    expect(candy).toMatch(/\$candy-radius-sm:\s*var\(--shape-radius-sm,\s*#\{\$candy-radius-sm-static\}\)/);
    expect(candy).toMatch(/\$candy-radius-xs:\s*var\(--shape-radius-xs,\s*#\{\$candy-radius-xs-static\}\)/);
    expect(candy).toMatch(/\$candy-radius-static:\s*14px;/);
    expect(candy).toMatch(/\$candy-radius-sm-static:\s*10px;/);
    expect(candy).toMatch(/\$candy-radius-xs-static:\s*4px;/);
  });

  // #140. `$smaller`/`$small`/`$medium`/`$large` are SPACING — gaps and
  // paddings. As a radius they are a category error with a concrete cost: change
  // a gap and corners across the app bend with it, and no look can reach them,
  // because they bypass `--shape-radius-*`. When this was written there were 19
  // of them, 8px context-menu rows inside a 10px menu among them. Each one was
  // decided per element: `$candy-radius-sm` (buttons, rows, thumbnails) or the
  // new `$candy-radius-xs` (tags inside a line of text, skeleton bars).
  // #141. The design has TWO line weights: `$candy-border-w` (3px) for plates,
  // rows and cards, and the hairline (1px) for chips inside a line of text,
  // tooltips, small inputs and separators. Before this the hairline existed only
  // as seventeen copies of `1px solid $mem-line`, so nothing said it was a role
  // or where it stopped. A literal 1px now means someone is inventing a third.
  it("the hairline is a token, never a literal 1px", () => {
    const candy = readFileSync(CANDY, "utf-8");
    expect(candy).toMatch(/\$mem-hairline-w:\s*1px;/);
    expect(candy).toMatch(/\$mem-hairline:\s*\$mem-hairline-w solid \$mem-line;/);
    expect(offenders(/(border(-top|-bottom|-left|-right)?|outline):[^;]*\b1px\b/)).toEqual([]);
  });

  // #233. The third line weight, found by the census after #141: 160 elements
  // at 2px, arrived with the cassette inlay (the ring around track number and
  // duration in every song row). Intentional, so it is named, not flattened —
  // `$mem-ring-w` for strokes around things that sit on a surface,
  // `$focus-ring-w` for the keyboard outline, which must not move with them.
  it("the ring and the focus outline are tokens, never a literal 2px", () => {
    const candy = readFileSync(CANDY, "utf-8");
    expect(candy).toMatch(/\$mem-ring-w:\s*2px;/);
    expect(candy).toMatch(/\$focus-ring-w:\s*2px;/);
    expect(offenders(/(border(-top|-bottom|-left|-right)?|outline):[^;]*\b2px\b/, "")).toEqual([]);
  });

  // #141, second half. Hard shadows step 3px (resting) and 4px (raised); the
  // modal and the Now-Playing panel float higher on purpose. A 2px offset was
  // on three elements against more than a thousand at 3px or 4px — drift, and
  // the mixins accept any value, so only this stops a fourth step appearing.
  it("no hard shadow is shallower than the resting 3px", () => {
    expect(offenders(/(candy-shadow|mem-shadow|candy-raised)\(\s*[12]px/, "")).toEqual([]);
    expect(offenders(/(candy-shadow|mem-shadow|candy-raised)\(\s*\d+px\s*,\s*[12]px/, "")).toEqual([]);
  });

  it("no corner is a spacing token", () => {
    expect(offenders(/border-radius:[^;]*\$(smaller|small|medium|large)\b/, "")).toEqual([]);
  });

  it("the detail head and the play CTA are the look's to paint (#200)", () => {
    // The head is a PLATE in Memphis; a cover-tinted look lets the page's own
    // tint be the head, and the primary play button carries the look's colour.
    const head = readFileSync("src/assets/scss/Global/detail-head.scss", "utf-8");
    expect(head).toMatch(/candy-box\(var\(--look-detail-head-fill, #\{\$mem-panel\}\)/);
    expect(head).toMatch(/font-size: var\(--shape-detail-title, #\{\$detail-title-size\}\)/);
    expect(head).toMatch(/font-size: var\(--shape-detail-title-phone, #\{\$detail-title-size-phone\}\)/);

    const buttons = readFileSync("src/assets/scss/Global/_buttons.scss", "utf-8");
    expect(buttons).toMatch(/background-color: var\(--look-play-fill, #\{\$mem-teal\}\)/);
    expect(buttons).toMatch(/color: var\(--look-play-glyph, #\{\$mem-ink\}\)/);
  });

  it("the textures fall back to the Memphis artwork", () => {
    const candy = readFileSync(CANDY, "utf-8");
    expect(candy).toMatch(/var\(--shape-sprinkle,\s*url\('data:image\/svg\+xml/);
    expect(candy).toMatch(/var\(--shape-doodles,\s*url\("@\/assets\/images\/memphis-doodles\.svg"\)\)/);
  });

  it("Memphis does not set any shape token itself — the fallbacks are the design", () => {
    // A `--shape-*` DEFINITION in a Memphis stylesheet would make the fallback
    // dead code and the pixel-equality argument of #198 void. The one file
    // allowed to set them is the Stream look, and only under its own class.
    // Same for the accent family `--look-*` (#199).
    expect(offenders(/^\s*--(shape|look)-[a-z-]+\s*:/, STREAM)).toEqual([]);
  });

  it("the Stream look sets its tokens only under body.theme-stream", () => {
    // Comments out, and Sass interpolations (`#{$brand-green}`) flattened —
    // their braces would otherwise split a declaration block in two.
    const stream = readFileSync(STREAM, "utf-8")
      .replace(/\/\/.*$/gm, "")
      .replace(/#\{[^}]*\}/g, "X");
    const blocks = [...stream.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const withShape = blocks.filter(([, , body]) => /--(shape|look)-/.test(body));
    expect(withShape.length).toBeGreaterThan(0);
    for (const [, selector] of withShape) expect(selector.trim()).toBe("body.theme-dark.theme-stream");
  });
});
