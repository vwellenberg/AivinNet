import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Captioned sections keep ONE rhythm, whichever component draws them.
//
// Favorites draws its sections with CardScroller, Playlists with
// PlaylistCardGroup. Each had its own numbers: 24px caption-to-tile and 56px
// between sections there, 8px and 64px here. Neither looked wrong on its own
// page — the user saw it on the phone, switching between the two neighbouring
// tabs: the tiles under "Recently favorited" and "Pinned" jumped by 16px.
//
// Both now read $section-caption-gap and $section-gap; this test keeps a third
// number from creeping back into either file.
// ---------------------------------------------------------------------------

const scroller = readFileSync("src/components/shared/CardScroller.vue", "utf-8");
const group = readFileSync("src/components/PlaylistsList/PlaylistCardGroup.vue", "utf-8");

describe("section rhythm", () => {
  it("puts the same gap under every section caption", () => {
    expect(scroller).toMatch(/\.rinfo \{[^}]*margin-bottom: \$section-caption-gap;/);
    expect(group).toMatch(/h3 \{[^}]*margin: 0 0 \$section-caption-gap;/);
  });

  it("puts the same gap between two sections", () => {
    // CardScroller pads half above and half below, so two rows meet at the
    // full gap; the playlist group carries it as a bottom margin.
    expect(scroller).toMatch(/\.cardscroller \{[^}]*padding: calc\(#\{\$section-gap\} \/ 2\) 0;/);
    expect(group).toMatch(/\.playlistcardgroup \{[^}]*margin-bottom: \$section-gap;/);
  });
});
