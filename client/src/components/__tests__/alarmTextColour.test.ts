import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// `$red` is not red. In candy it is static ink (`_variables.scss`: "alarm
// accents are black in candy"), the same in both themes. As a TEXT colour on a
// surface that turns dark with the theme — a modal, a panel — it is therefore
// invisible in dark mode, and nothing reports it: the metadata dialog's error
// line, its "name is taken" notes and its "…s off" marks all stood there as
// ink on near-black (#299, found in the preview of the new failure list).
//
// Alarm text takes the theme's text colour (`$candy-text`) and says it with
// weight. `$red` stays usable as a FILL — an accent plate keeps its colour in
// both themes.
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
/** `color: $red`, but not `background-color: $red`. */
const TEXT_IN_RED = /(^|[^-\w])color:\s*\$red\b/m;

describe("alarm text", () => {
  it("reads the source tree (guards the walk itself)", () => {
    expect(FILES.length).toBeGreaterThan(200);
    expect(FILES.some(f => f.endsWith("FetchMetadata.vue"))).toBe(true);
    expect(FILES.some(f => f.endsWith(".scss"))).toBe(true);
  });

  it("the pattern tells text from a fill", () => {
    expect(TEXT_IN_RED.test("    .error {\n        color: $red;\n")).toBe(true);
    expect(TEXT_IN_RED.test("      background-color: $red;")).toBe(false);
  });

  it("never colours text with the static ink of $red", () => {
    const offenders = FILES.filter(file => TEXT_IN_RED.test(readFileSync(file, "utf-8")));
    expect(offenders, "use $candy-text (theme ink/paper) for alarm text").toEqual([]);
  });
});
