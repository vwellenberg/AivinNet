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
    expect(panelSource).toContain('class="sidebar-pl-placeholder is-folder"');
    expect(itemSource).toContain("<PlaylistSvg />");
    expect(placeholder, ".sidebar-pl-placeholder block not found").not.toBe("");
  });

  it("tags the pinned music folder as a folder", () => {
    expect(panelSource).toMatch(/class="sidebar-pl-placeholder is-folder">\s*<FolderSvg \/>/);
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

  // The playlist FOLDER head is a third picture-less row, and the one the user
  // actually saw: the first round only reached the pinned music folder, and the
  // head kept its solid black glyph on the row's own fill (2026-11-09).
  // Its colour is the PLAYLIST pink: it holds playlists. Kraft is for music
  // folders only — the first version used kraft here and mixed the two up.
  it("gives the playlist folder head the playlist pastel and an ink glyph", () => {
    expect(panelSource).toMatch(/class="folder-icon-slot">\s*<FolderSvg class="folder-icon" \/>/);
    const css = styleBlock(panelSource);
    const slot = block(css, ".folder-icon-slot").body;
    expect(slot, ".folder-icon-slot block not found").not.toBe("");
    expect(slot).toMatch(/@include mem-entity-tint\("playlist"\)/);
    expect(slot).not.toMatch(/mem-entity-tint\("folder"\)/);
    expect(slot).not.toMatch(/var\(--row-fill\)/);
    expect(block(css, ".folder-icon").body).toMatch(/color:\s*\$mem-ink;/);
  });

  // Every picture in the app wears an ink frame; the sidebar's 28px thumbnails
  // were the last without one (user, 2026-11-09). Both boxes carry it — the
  // thumbnail (cover, mosaic, placeholder) and the playlist folder's icon tile.
  it("frames the thumbnail box and the folder icon tile in the ink ring", () => {
    const css = styleBlock(panelSource);
    const ring = /border:\s*\$mem-ring-w solid \$mem-line;/;
    const thumb = block(css, ".sidebar-pl-img").body;
    expect(thumb, ".sidebar-pl-img block not found").not.toBe("");
    expect(thumb).toMatch(ring);
    expect(block(css, ".folder-icon-slot").body).toMatch(ring);
  });

  // The playlist folder head draws the OUTLINE folder, like the "Folders" nav
  // entry and every other icon in the list. The filled variant read as a solid
  // block on its pastel tile (user, 2026-11-09); the tint tells the two kinds
  // of folder apart now, not the glyph.
  it("draws both folders with the outline glyph, never the filled one", () => {
    expect(panelSource).toMatch(/import FolderSvg from "@\/assets\/icons\/folder\.svg";/);
    expect(panelSource).not.toMatch(/folder\.fill\.svg/);
  });
});
