import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { block } from "./scssBlocks";

// ---------------------------------------------------------------------------
// The media cell of the three detail heads (album, artist, playlist) has to be
// SQUARE by declaration, not by hope.
//
// It used to say `width: 11rem; min-height: 11rem` and let the image inside
// carry `height: 100%`. That percentage only resolves against a definite height,
// and `min-height` is not one — so on any non-square cover the fallback (`auto`)
// applied and the IMAGE sized the cell. Measured on a 512×735 portrait cover:
// the cell rendered 176×253, the plate grew 49px, and because `.dh-body` lays
// its rows out with `space-between`, every one of those pixels became a gap
// between the title and the meta line (#512).
//
// The tell was that it looked like a bug in the TEXT column, and the obvious
// suspect — a long title pushing things apart — was wrong: a 31-character title
// measured the same 24px gap as a 10-character one, because the title is single
// line and ellipsed. Only the artwork's aspect ratio moved it.
//
// Non-square artwork is routine in this library (CD case scans, Windows Media
// Player `Folder.jpg` leftovers), so this is the normal case rather than an edge
// one — which is why the guarantee belongs in a test instead of in a screenshot
// somebody took once.
// ---------------------------------------------------------------------------

const SCSS = "src/assets/scss/Global/detail-head.scss";

describe("the detail head's media cell", () => {
    const css = readFileSync(SCSS, "utf8");
    const art = block(css, ".dh-art").body;

    // A source-parsing test goes quietly green when its parser stops matching,
    // so the block itself is the first assertion.
    it("finds the .dh-art block to read", () => {
        expect(art).not.toBe("");
    });

    it("is square by aspect-ratio, so the image can never size it", () => {
        expect(art).toMatch(/aspect-ratio:\s*1\s*;/);
    });

    // The percentage is the half that actually needed the aspect-ratio above;
    // the album head overrides `cover` with `contain` on purpose, so only the
    // shared default is asserted here.
    it("still gives the image a height to fill", () => {
        expect(art).toMatch(/height:\s*100%/);
        expect(art).toMatch(/object-fit:\s*cover/);
    });

    // The cell must keep growing with a two-line title — a cell pinned to its
    // own height leaves a slab of empty panel under the artwork, which is the
    // bug the stretch was added for in the first place.
    it("still stretches with the plate", () => {
        expect(art).toMatch(/align-self:\s*stretch/);
    });
});
