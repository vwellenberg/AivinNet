import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// The library's [+] on desktop and the phone's [+] in the top bar both create a
// PLAYLIST. The desktop one used to open the folder dialog, so the same glyph
// did two different things per platform. Folders stay reachable through a
// playlist's "New folder…" menu entry.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob(["/src/components/LeftSidebar/index.vue", "/src/components/nav/NavBar.vue"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const sidebar = SOURCES["/src/components/LeftSidebar/index.vue"] ?? "";
const navbar = SOURCES["/src/components/nav/NavBar.vue"] ?? "";

/** The body of a top-level `function name() { … }` (its closing brace sits at column 0). */
function bodyOf(src: string, name: string): string {
  const m = src.match(new RegExp(`function ${name}\\(\\)\\s*\\{([\\s\\S]*?)\\n\\}`));
  return m?.[1] ?? "";
}

describe("the library's [+] matches the phone's", () => {
  it("found both sources", () => {
    expect(sidebar).toContain("sidebar-newplaylist");
    expect(navbar).toContain("showNewPlaylistModal");
  });

  it("the library's [+] calls the playlist handler, not the folder one", () => {
    expect(sidebar).toMatch(/class="sidebar-newplaylist"[^>]*@click="onNewPlaylist"/);
    const body = bodyOf(sidebar, "onNewPlaylist");
    expect(body, "onNewPlaylist not found").not.toBe("");
    expect(body).toMatch(/modal\.showNewPlaylistModal\(\)/);
    expect(body).not.toMatch(/showFolderModal/);
  });

  it("the phone's [+] opens the same dialog", () => {
    expect(navbar).toMatch(/handler:\s*\(\)\s*=>\s*modal\.showNewPlaylistModal\(\)/);
  });
});
