import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The pin glyph is a sewing pin DRAWN on the 45-degree diagonal (pin.svg, pin.fill.svg, push-pin.svg;
// #809). The sidebar used to tilt the old upright thumbtack by 35deg in CSS;
// left in place, that tilt stacked on the drawn one and laid the new pin almost
// flat in the sidebar while every other place showed it upright on the
// diagonal (user, 2026-11-15). The glyph carries its own angle, so no rule that
// draws it may rotate it again.
// ---------------------------------------------------------------------------

const SIDEBAR = readFileSync("src/components/LeftSidebar/index.vue", "utf-8");
// The sidebar draws its pin only on a PINNED row, so it is the filled-head
// state (pin.fill.svg), the same glyph PinButton shows for "pinned".
const PIN = readFileSync("src/assets/icons/pin.fill.svg", "utf-8");
const ITEM = readFileSync("src/components/LeftSidebar/SidebarPlaylistItem.vue", "utf-8");

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

describe("the sidebar marks a pinned row with the filled pin", () => {
  // The hollow head is the "not pinned" state, yet the sidebar wore it on every
  // pinned row (user, 2026-11-20).
  it.each([
    ["LeftSidebar/index.vue", SIDEBAR],
    ["SidebarPlaylistItem.vue", ITEM],
  ])("%s imports pin.fill.svg, not the hollow push-pin.svg", (_name, src) => {
    expect(src).toMatch(/import PinnedSvg from ["']@\/assets\/icons\/pin\.fill\.svg["']/);
    expect(src).not.toMatch(/push-pin\.svg["']/);
    expect(src).toMatch(/<PinnedSvg /);
  });
});

describe("the sidebar pin keeps the angle it is drawn with", () => {
  it("the glyph itself runs from head top-right to point lower-left", () => {
    const needle = PIN.match(/<path d="M[\d.]+ [\d.]+L([\d.]+) ([\d.]+)L/);
    expect(needle, "needle wedge not found").not.toBeNull();
    const [tipX, tipY] = [Number(needle![1]), Number(needle![2])];
    expect(tipX).toBeLessThan(12);
    expect(tipY).toBeGreaterThan(12);
  });

  it.each([".pl-pin", ".folder-pin"])("%s is not rotated on top of that", (selector) => {
    const css = block(SIDEBAR, selector);
    expect(css).not.toMatch(/transform:/);
    expect(css).not.toMatch(/rotate/);
  });
});
