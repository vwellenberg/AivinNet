import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The rendered stroke of a chrome glyph is 2.4 x size / 24 — the drawing is
// fixed, so the SIZE decides how heavy the line is. A glyph that stands alone
// on a plate needs 20px to reach 2px, the ring width and the thinnest ink line
// a plate carries. The sidebar's pin stood at 0.95rem: a 1.5px stroke between
// 3px frames and a 2px thumbnail ring, reported as "out of place" (user,
// 2026-11-13). Measured in the running client per glyph: computed
// stroke-width x rendered width / viewBox width.
// ---------------------------------------------------------------------------

const BUTTONS = readFileSync("src/assets/scss/Global/_buttons.scss", "utf-8");
const SIDEBAR = readFileSync("src/components/LeftSidebar/index.vue", "utf-8");
const PIN = readFileSync("src/assets/icons/push-pin.svg", "utf-8");

function block(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start, `${selector} not found`).toBeGreaterThan(-1);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}" && --depth === 0) return css.slice(start, i);
  }
  return css.slice(start);
}

describe("a lone glyph is drawn heavy enough", () => {
  it("the token is the size at which the chrome stroke reaches the ring width", () => {
    const rem = Number(BUTTONS.match(/^\$glyph-lone: ([\d.]+)rem;/m)?.[1]);
    const stroke = Number(PIN.match(/stroke-width="([\d.]+)"/)?.[1]);
    const grid = Number(PIN.match(/viewBox="0 0 (\d+) \d+"/)?.[1]);
    expect((stroke * rem * 16) / grid).toBeGreaterThanOrEqual(2);
  });

  it("the sidebar pin takes it instead of a literal", () => {
    const pin = block(SIDEBAR, ".pl-pin");
    expect(pin).toMatch(/width: \$glyph-lone;/);
    expect(pin).toMatch(/height: \$glyph-lone;/);
  });
});

describe("the sidebar thumbnails share one frame", () => {
  it("playlist cover and folder cover take the same ring and the same radius", () => {
    const uses = [...SIDEBAR.matchAll(/border: \$mem-ring-w solid \$mem-line;\s*(?:\/\/[^\n]*\s*)*border-radius: \$sidebar-thumb-radius;/g)];
    expect(uses).toHaveLength(2);
    // Concentric in the row: the row's radius minus its frame.
    expect(SIDEBAR).toMatch(/^\$sidebar-thumb-radius: calc\(#\{\$candy-radius-sm\} - #\{\$candy-border-w\}\);/m);
  });
});
