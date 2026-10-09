import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The active nav entry reaches past the sidebar's frame — except where the
// panel is a scroll container (#420).
//
// On short windows the whole panel scrolls (`.whole-scroll`, utils/sidebarFit).
// A scroller clips x, so the reach-out was cut off at the frame: reported as
// "the menu arrow is clipped after a window change", because the user's window
// sat right at the threshold and flipped with 10px of height. The reach is a
// custom property the panel takes back in that mode.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/components/LeftSidebar/*.vue", { as: "raw", eager: true }) as Record<
  string,
  string
>;

const nav = styleBlock(SOURCES["/src/components/LeftSidebar/NavButtons.vue"] ?? "");
const panel = styleBlock(SOURCES["/src/components/LeftSidebar/index.vue"] ?? "");

describe("the active entry's reach", () => {
  it("found both stylesheets", () => {
    expect(nav).toContain(".nav-item");
    expect(panel).toContain(".l-sidebar");
  });

  it("is read from --nav-reach, so the panel can take it back", () => {
    const active = block(nav, ".nav-item.active:not(.separator)").body;
    expect(active, "active entry block not found").not.toBe("");
    expect(active).toMatch(/width:\s*calc\(100% \+ var\(--nav-reach,\s*1\.6rem\)\)/);
  });

  it("is zero while the whole panel scrolls", () => {
    const whole = block(panel, "&.whole-scroll").body;
    expect(whole, ".whole-scroll block not found").not.toBe("");
    expect(whole).toMatch(/overflow-y:\s*auto/);
    expect(whole).toMatch(/--nav-reach:\s*0(px)?;/);
  });

  it("the scrolling panel keeps the list's quiet scrollbar", () => {
    const whole = block(panel, "&.whole-scroll").body;
    expect(whole).toMatch(/scrollbar-width:\s*thin/);
    expect(whole).toMatch(/scrollbar-color:\s*transparent transparent/);
  });
});
