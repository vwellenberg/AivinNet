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
    expect(candy).toMatch(/\$candy-radius-static:\s*14px;/);
    expect(candy).toMatch(/\$candy-radius-sm-static:\s*10px;/);
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
    expect(offenders(/^\s*--shape-[a-z-]+\s*:/, STREAM)).toEqual([]);
  });

  it("the Stream look sets its shape tokens only under body.theme-stream", () => {
    const stream = readFileSync(STREAM, "utf-8").replace(/\/\/.*$/gm, "");
    const blocks = [...stream.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
    const withShape = blocks.filter(([, , body]) => /--shape-/.test(body));
    expect(withShape.length).toBeGreaterThan(0);
    for (const [, selector] of withShape) expect(selector.trim()).toBe("body.theme-dark.theme-stream");
  });
});
