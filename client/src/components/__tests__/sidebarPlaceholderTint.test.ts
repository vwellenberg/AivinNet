import { describe, expect, it } from "vitest";

import { block, styleBlock } from "./scssBlocks";

// ---------------------------------------------------------------------------
// A library row without a picture wears its ENTITY's pastel (user, 2026-11-09).
//
// The pinned music folder and the picture-less playlist used to share the
// generic blush with a glyph at 50 % — beside two album covers the folder row
// read as a hole. Now they follow the tiles' rule: folder kraft, playlist pink,
// glyph in static ink. This guards both halves: the template has to put the
// entity class on the placeholder, and the stylesheet has to answer it.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob("/src/components/LeftSidebar/*.vue", { query: "?raw", import: "default", eager: true }) as Record<
  string,
  string
>;

const panelSource = SOURCES["/src/components/LeftSidebar/index.vue"] ?? "";
const itemSource = SOURCES["/src/components/LeftSidebar/SidebarPlaylistItem.vue"] ?? "";
const placeholder = block(styleBlock(panelSource), ".sidebar-pl-placeholder").body;

describe("sidebar placeholders wear their entity's pastel", () => {
  it("found the sources and the placeholder rule", () => {
    expect(panelSource).toContain("<DirSvg />");
    expect(itemSource).toContain("<PlaylistSvg />");
    expect(placeholder, ".sidebar-pl-placeholder block not found").not.toBe("");
  });

  it("tags the pinned music folder as a folder", () => {
    expect(panelSource).toMatch(/class="sidebar-pl-placeholder is-folder">\s*<DirSvg \/>/);
  });

  it("tags the picture-less playlist as a playlist", () => {
    expect(itemSource).toMatch(/class="sidebar-pl-placeholder is-playlist">\s*<PlaylistSvg \/>/);
  });

  it("fills each with its entity tint", () => {
    expect(block(placeholder, "&.is-folder").body).toMatch(/@include mem-entity-tint\("folder"\)/);
    expect(block(placeholder, "&.is-playlist").body).toMatch(/@include mem-entity-tint\("playlist"\)/);
  });

  it("draws the glyph in static ink at full strength on the static pastel", () => {
    const glyph = block(placeholder, "&.is-playlist svg").body;
    expect(placeholder, "the ink rule has to cover the folder glyph too").toMatch(/&\.is-folder svg,\s*&\.is-playlist svg\s*\{/);
    expect(glyph).toMatch(/color:\s*\$mem-ink;/);
    expect(glyph).toMatch(/opacity:\s*1;/);
  });
});
