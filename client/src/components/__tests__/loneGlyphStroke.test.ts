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

  // Both sidebar pins, playlist and folder: they stand in one column, and the
  // folder pin kept the old 0.95rem literal after the playlist pin moved to the
  // token, so it drew visibly smaller in the same column (user, 2026-11-15).
  it.each([".pl-pin", ".folder-pin"])("the sidebar pin %s takes it instead of a literal", (selector) => {
    const pin = block(SIDEBAR, selector);
    expect(pin).toMatch(/width: \$glyph-lone;/);
    expect(pin).toMatch(/height: \$glyph-lone;/);
  });
});

describe("the folder head's chevron", () => {
  // It stood at 0.7rem next to the 1.25rem pin: an arrow with a ~1px stroke
  // beside a 2px one, reported as "too thin" (user, 2026-11-15). Scaling the
  // arrow up to reach 2px made it the loudest thing in the row; the chrome
  // set's disclosure chevron (expand.svg) carries a heavier stroke at a smaller
  // size instead.
  it("is the disclosure chevron, not the arrow", () => {
    expect(SIDEBAR).toMatch(/import FolderChevronSvg from "@\/assets\/icons\/expand\.svg";/);
    expect(SIDEBAR).toMatch(/<FolderChevronSvg class="folder-chevron"/);
  });

  // At the pin's 1.25rem it read too big beside the count (user, 2026-11-17);
  // 1rem still draws its stroke at 1.6px, against ~1px for the old arrow.
  it("sits a step below the pin", () => {
    const chevron = block(SIDEBAR, ".folder-chevron");
    expect(chevron).toMatch(/width: 1rem;/);
    expect(chevron).toMatch(/height: 1rem;/);
  });

  // The folder opens DOWNWARD, so the closed chevron points down — it used to
  // point right (user, 2026-11-17) — and the open one up. expand.svg is drawn
  // pointing right, hence the rotations.
  it("points down when closed and up when open", () => {
    const chevron = block(SIDEBAR, ".folder-chevron");
    const at = chevron.indexOf("&.open");
    expect(at, "no &.open state").toBeGreaterThan(-1);
    const open = chevron.slice(at);
    expect(chevron.slice(0, at)).toMatch(/transform: rotate\(90deg\);/);
    expect(open).toMatch(/transform: rotate\(-90deg\);/);
  });
});

describe("the folder head's count", () => {
  // At 0.75rem (12px) it sat between a 15px name and the 20px chevron and pin,
  // the one small thing in the row (user, 2026-11-16). It takes the row's size.
  it("is set at the row's font size", () => {
    const count = block(SIDEBAR, ".folder-count");
    expect(count).toMatch(/font-size: \$sidebar-row-font;/);
  });
});

describe("the sidebar thumbnails share one frame", () => {
  it("playlist cover and folder cover take the same plate-width frame and the same radius", () => {
    const uses = [...SIDEBAR.matchAll(/border: \$candy-border-w solid \$mem-line;\s*(?:\/\/[^\n]*\s*)*border-radius: \$sidebar-thumb-radius;/g)];
    expect(uses).toHaveLength(2);
    // Concentric in the row: the row's radius minus its frame.
    expect(SIDEBAR).toMatch(/^\$sidebar-thumb-radius: calc\(#\{\$candy-radius-sm\} - #\{\$candy-border-w\}\);/m);
  });
});
