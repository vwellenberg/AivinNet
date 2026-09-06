import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The settings modal has ONE height for every pane.
//
// Its panes differ a lot in length — Profile is a handful of fields, Appearance
// is nine setting plates — and the modal is centred, so a box sized by its
// content moved all four edges on every tab switch. Measured at 1440x900 before
// the fix: Appearance at y=32 h=836, every other pane at y=113 h=674, i.e. the
// close button and the whole nav list jumped 81px between two clicks. The user
// reported it as the window jumping back and forth.
//
// Two declarations carry the fix, in two different files:
//   - `.m-content.settings` states the height, from the token, capped by the
//     window (a pane scrolls inside the frame — it already could)
//   - `.settingsmodal` takes `flex: 1`, or it would keep sizing itself to its
//     content inside a box that now has a height of its own, leaving the
//     sidebar's frame hanging in mid-air
//
// That the frame actually stands still was verified in a browser: identical
// rects across all seven tabs at 1440x900 and 1280x720, and across list/detail
// at 390 and 360 wide.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");

const VARIABLES = read("src/assets/scss/_variables.scss");
const MODAL = styleBlock(read("src/components/modal.vue"));
const SETTINGS = styleBlock(read("src/components/modals/Settings.vue"));

/**
 * A rule's OWN declarations (breakpoint overrides kept, child blocks dropped),
 * with a guard so a broken parse fails loudly instead of quietly green.
 *
 * Own declarations, not the whole body: `.settingsmodal` contains an `.h2` that
 * declares `flex: 1` itself, so a body-wide match would keep passing after the
 * `flex: 1` this test is about was deleted.
 */
function rule(css: string, selector: string): string {
  const { body } = block(css, selector);
  expect(body, `${selector} not found`).not.toBe("");
  return ownDeclarations(body);
}

describe("the settings modal keeps one height", () => {
  it("declares that height as a token", () => {
    expect(VARIABLES).toMatch(/^\$settings-modal-h:\s*\d+(\.\d+)?rem;/m);
  });

  it("sizes the modal from the token, not from its content", () => {
    const settings = rule(MODAL, ".m-content.settings");
    // `height`, anchored, and BOTH of them: the desktop rule and the phone
    // override. Counting one match let a mutation slip through — flipping the
    // desktop declaration to `max-height` (the content sizing this replaced)
    // still found the phone one and passed.
    const heights = settings.match(/(?:^|[\s;{])height:\s*min\([^;]*\$settings-modal-h[^;]*;/g);
    expect(heights?.length, "both breakpoints state the height from the token").toBe(2);
    // The other half of the same statement: a cap is not a height.
    expect(settings).not.toMatch(/max-height:/);
  });

  it("lets the panes fill that height", () => {
    expect(rule(SETTINGS, ".settingsmodal")).toMatch(/flex:\s*1;/);
  });

  it("measures the viewport the way the phone sees it", () => {
    // A fixed share of `.modal` is only right if `.modal` itself is the VISIBLE
    // viewport: `100vh` ignores the browser's chrome, so the modal's bottom rows
    // would sit under the address bar. `vh` first, `dvh` second (the fallback
    // order `body` uses).
    const modal = rule(MODAL, ".modal");
    expect(modal).toMatch(/height:\s*100vh;/);
    expect(modal).toMatch(/height:\s*100dvh;/);
  });
});
