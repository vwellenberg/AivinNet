import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// The favourites page shows PREVIEWS: a row of favourite albums, one of
// favourite artists, a few favourite tracks — each leads to its full page.
// Two things went wrong there (reported 2026-10-04):
//
//   1. The captions said "Albums" / "Artists" / "Tracks", i.e. the names of
//      the library pages the navigation now links to — on the favourites page
//      that read as "all albums".
//   2. "See all" only appears in a CardScroller once the row is FULL. With four
//      favourite albums the row was not, so nothing said that the caption
//      leads to the complete list.
const favorites = readFileSync("src/views/Favorites.vue", "utf-8");
const scroller = readFileSync("src/components/shared/CardScroller.vue", "utf-8");

describe("favourites page rows", () => {
  it("name what they preview", () => {
    expect(favorites).toContain(":title=\"'Favorite tracks'\"");
    expect(favorites).toContain(":title=\"'Favorite albums'\"");
    expect(favorites).toContain(":title=\"'Favorite artists'\"");
    expect(favorites).not.toMatch(/:title="'(Tracks|Albums|Artists)'"/);
  });

  it("always offer See all for albums and artists", () => {
    for (const route of ["/favorites/albums", "/favorites/artists"]) {
      const at = favorites.indexOf(`:route="'${route}'"`);
      expect(at, route).toBeGreaterThan(-1);
      // The flag sits on the same CardScroller, right after its route.
      expect(favorites.slice(at, at + 80), route).toMatch(/always-see-all/);
    }
  });

  it("lets the flag override the full-row rule in both See all spots", () => {
    const conditions = scroller.match(/<SeeAll\s+v-if="[^"]*"/g) ?? [];
    expect(conditions).toHaveLength(2);
    for (const c of conditions) {
      expect(c).toContain("alwaysSeeAll || itemlist.length >= maxAbumCards");
    }
  });
});
