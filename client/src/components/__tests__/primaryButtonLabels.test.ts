import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// A `btn-primary` paints its sprinkle texture over the whole button. CSS can
// lift and cover an ELEMENT above it (`> .text`, `> svg` in btn-primary), but
// it cannot reach a bare text node — so a label written straight into the
// button gets the strokes running through its letters. That is what "Continue"
// on Home did (reported 2026-10-05), and a census then found nine more in the
// sync calibration and the devices modal.
//
// The rule: every text in a btn-primary sits in `<span class="text">`. This
// census holds it for every template, so the next button cannot forget it.
// (The other roles — btn-action, btn-pill — draw their texture as a ring
// around the label and need no wrapper.)

function vueFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : vueFiles(path);
    return path.endsWith(".vue") ? [path] : [];
  });
}

const BUTTON = /<(button|RouterLink|router-link|a|div|span)\b[^>]*class="[^"]*\bbtn-primary\b[^"]*"[^>]*>([\s\S]*?)<\/\1>/g;

function bareText(inner: string): string {
  return inner
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<([\w-]+)\b[^>]*\/>/g, "")
    .replace(/<([\w-]+)\b[^>]*>[\s\S]*?<\/\1>/g, "")
    .trim();
}

const files = vueFiles("src");

describe("btn-primary labels", () => {
  it("finds the buttons it claims to check", () => {
    // Guard over the scan itself: a regex that matches nothing passes forever.
    const count = files.reduce((n, f) => n + [...readFileSync(f, "utf-8").matchAll(BUTTON)].length, 0);
    expect(count).toBeGreaterThan(5);
  });

  it("never leave text bare inside the button", () => {
    const offenders: string[] = [];

    for (const file of files) {
      const source = readFileSync(file, "utf-8");
      const template = source.slice(0, source.indexOf("<script") >= 0 ? source.indexOf("<script") : undefined);

      for (const m of template.matchAll(BUTTON)) {
        const text = bareText(m[2]);
        if (text) offenders.push(`${file}: "${text.slice(0, 40)}"`);
      }
    }

    expect(offenders).toEqual([]);
  });
});
