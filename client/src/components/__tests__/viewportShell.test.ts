import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The app shell takes its height from the viewport box, never from viewport
// UNITS.
//
// Reported from a phone (Vivaldi, Android), and not for the first time: turned
// from landscape back to portrait, the whole UI sat in the top half of the
// screen — title bar, Now Playing, the player bar in the MIDDLE of the display,
// bare ground below it. The width media queries had flipped to the portrait
// bar correctly; only the height was the landscape one.
//
// The shell's height chain was html (auto) → body `100vh` / `100dvh` → #app
// 100% → #app-grid 100%, and nothing in the app sets a height from script —
// the viewport units were the only thing in that chain that could hold an old
// value. They can: on Android the browser keeps its viewport-unit sizes across
// an orientation change in some states, while the initial containing block
// (what media queries and percentage heights resolve against) follows the
// rotation. So the chain now starts at `html { height: 100% }`, and a fixed box
// that has to cover the screen (`.modal`) is pinned with `inset: 0`.
//
// Headless Chromium updates both on a resize, so no screenshot shows the bug —
// which is why this is a source rule and not a measurement. Verified by hand:
// the chain renders the full height at 390x844, 844x390 and after a resize
// from one to the other.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");
const stripComments = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const INDEX = stripComments(read("src/assets/scss/Global/index.scss"));
const APP_GRID = stripComments(read("src/assets/scss/Global/app-grid.scss"));
const MODAL = styleBlock(read("src/components/modal.vue"));

/** Any viewport-relative length: vh, vw, and their d/s/l variants. */
const VIEWPORT_UNIT = /\b\d+(?:\.\d+)?[dsl]?v(?:h|w|min|max)\b/;

function rule(css: string, selector: string): string {
  const { body } = block(css, selector);
  expect(body, `${selector} not found`).not.toBe("");
  return ownDeclarations(body);
}

describe("the app shell's height", () => {
  it("starts at the root: html is 100% of the viewport box", () => {
    expect(rule(INDEX, "html")).toMatch(/(?:^|[\s;{])height:\s*100%;/);
  });

  it("carries body at 100% of html", () => {
    expect(rule(INDEX, "body")).toMatch(/(?:^|[\s;{])height:\s*100%;/);
  });

  // The regression itself. Each of these used to be — or would be the natural
  // place to put — a `100vh` / `100dvh`.
  it.each([
    ["html", INDEX],
    ["body", INDEX],
    ["#app", INDEX],
    ["#app-grid", APP_GRID],
  ])("%s is not sized in viewport units", (selector, css) => {
    const declarations = rule(css, selector);
    const offenders = declarations
      .split(";")
      .filter(d => /(?:^|[\s{])(?:min-|max-)?(?:height|width)\s*:/.test(d) && VIEWPORT_UNIT.test(d));
    expect(
      offenders.map(d => d.trim()),
      `${selector} is sized from viewport units again — those can keep their pre-rotation ` +
        "value on Android and leave the app in the top half of the screen"
    ).toEqual([]);
  });
});

describe("the modal layer covers the screen by its edges", () => {
  it("is fixed and pinned with inset: 0", () => {
    const modal = rule(MODAL, ".modal");
    expect(modal).toMatch(/position:\s*fixed;/);
    expect(modal).toMatch(/(?:^|[\s;{])inset:\s*0;/);
  });

  it("does not size itself from viewport units", () => {
    // Its settings box takes a fixed share of this element, so a stale height
    // here would cut the bottom rows off after a rotation.
    const modal = rule(MODAL, ".modal");
    const offenders = modal
      .split(";")
      .filter(d => /(?:^|[\s{])(?:height|width)\s*:/.test(d) && VIEWPORT_UNIT.test(d));
    expect(offenders.map(d => d.trim())).toEqual([]);
  });
});
