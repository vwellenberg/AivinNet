import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block, ownDeclarations, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The landscape phone bar keeps its controls apart and its title readable.
//
// Reported from a phone turned sideways, on Now Playing. Measured on the built
// client at 700x300 before the fix:
//   - the track title was 8px wide — one letter, "L"
//   - the devices button overlapped the seek bar's knob
//   - the page was 704px wide on a 700px screen
//
// One cause for the last two: `.left-group` was `flex: 1 1 20rem; min-width: 0`,
// a box allowed to shrink below the controls it holds, so they spilled out of
// it onto the seek bar. The first comes from the row's arithmetic — 512px of
// fixed controls leave no room for a title AND a usable seek bar below ~800px
// (see the `shortNarrowBar` mixin). The title now steps aside there instead of
// showing a letter, and below 700px the devices button does too.
//
// Measured after: no overlaps and no horizontal overflow at 640, 700, 760, 799,
// 800, 844 and 900 wide; the title is 104px at 800 and hidden below.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");

const BOTTOM_BAR = styleBlock(read("src/components/BottomBar/BottomBar.vue"));
const MIXINS = read("src/assets/scss/_mixins.scss");
const LEFT = read("src/components/BottomBar/Left.vue");

const SHORT = block(BOTTOM_BAR, "@include shortViewport").body;

describe("the landscape phone bar", () => {
  it("has a shortViewport block to check", () => {
    // Guard: a renamed mixin would turn every test below into a green no-op.
    expect(SHORT, "no `@include shortViewport { … }` in BottomBar.vue").not.toBe("");
  });

  it("never lets the track group shrink below its own controls", () => {
    const leftGroup = ownDeclarations(block(SHORT, ".left-group").body);
    expect(leftGroup, "no `.left-group` rule in the landscape block").not.toBe("");
    // `min-width: 0` is what let the transport and devices button spill onto
    // the seek bar. The default (`auto`) is the group's own minimum.
    expect(leftGroup).not.toMatch(/min-width:\s*0\b/);
    // Content-sized, not a growing basis: the seek bar is what takes the rest.
    expect(leftGroup).toMatch(/flex:\s*0 1 auto;/);
  });

  it("gives the title a readable minimum", () => {
    const title = ownDeclarations(block(block(SHORT, ".left-group").body, ".track-info").body);
    expect(title).toMatch(/min-width:\s*4\.5rem;/);
  });

  it("drops the title where title and seek bar cannot both fit", () => {
    const narrow = block(SHORT, "@include shortNarrowBar").body;
    expect(narrow, "no `@include shortNarrowBar` inside the landscape block").not.toBe("");
    expect(ownDeclarations(block(narrow, ".left-group .track-info").body)).toMatch(/display:\s*none;/);
  });

  it("drops the devices button where even that is not enough", () => {
    const narrowest = block(SHORT, "@include shortNarrowestBar").body;
    expect(narrowest, "no `@include shortNarrowestBar` inside the landscape block").not.toBe("");
    expect(ownDeclarations(block(narrowest, ".left-group .bar-controls .devices-btn").body)).toMatch(
      /display:\s*none;/
    );
  });

  it("puts the two thresholds where the measurement put them", () => {
    const width = (name: string) => {
      const m = new RegExp(`@mixin ${name}\\s*\\{[^}]*max-width:\\s*(\\d+)px`).exec(MIXINS);
      expect(m, `@mixin ${name} with a max-width not found`).toBeTruthy();
      return Number((m as RegExpExecArray)[1]);
    };
    // Title (80) + devices (56) + seek (112) on 512px of fixed row = 776, and
    // devices + seek = 680. Each breakpoint has to sit above its sum, or that
    // width overflows again.
    expect(width("shortNarrowBar")).toBeGreaterThanOrEqual(776);
    expect(width("shortNarrowestBar")).toBeGreaterThanOrEqual(680);
    expect(width("shortNarrowBar")).toBeGreaterThan(width("shortNarrowestBar"));
  });
});

describe("which bar the phone gets", () => {
  // The rich group (nine controls) switched on at 660px and left the title
  // 20px — "L" again, upright this time. The rule now lives in ONE place,
  // `isPhoneBar` in stores/content-width.ts (tested in shortViewport.test.ts);
  // the template must read it rather than restate a formula of its own.
  const script = LEFT.slice(LEFT.indexOf("<script"), LEFT.indexOf("</script>"))
    .split("\n")
    .filter(line => !/^\s*import\b/.test(line))
    .join("\n");

  it("reads isPhoneBar", () => {
    expect(script).toMatch(/const phoneBar = isPhoneBar\b/);
  });

  it("does not grow its own width rule back", () => {
    expect(script).not.toMatch(/isLargerMobile\.value/);
  });
});
