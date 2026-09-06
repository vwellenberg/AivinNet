import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// A drag carries an index, and an index only means something inside the list it
// came from. Two halves have to hold, and each was broken on its own:
//
//   1. A row that never opted into dragging must not start one. `<img>` is
//      natively draggable, so grabbing the cover fired `dragstart` on the row —
//      `draggable="false"` on the row does NOT stop that. Every search result
//      and album track was draggable through its cover.
//   2. A drop target must refuse a foreign source. `PlaylistView` took the
//      `source` argument and named it `_source`: received, ignored. A cover
//      dragged out of the search onto a playlist row reordered the playlist by
//      the search result's position.
//
// Together they were a path to silent data loss in a playlist — the class of
// bug this repo has already paid for twice (.claude/rules/playlist-writes.md).
//
// This is a source census rather than a behaviour test because the failure is
// an ABSENCE: nothing throws, nothing logs, the playlist just ends up in an
// order nobody asked for.
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, "utf-8");

const SONG_ITEM = "src/components/shared/SongItem.vue";
const TRACK_TITLE = "src/components/shared/SongItem/TrackTitle.vue";

/** Views that take a `trackDropped` and act on its indices. */
const DROP_TARGETS = ["src/views/NowPlaying/main.vue", "src/views/PlaylistView/index.vue"];

describe("a drag cannot start where it was never allowed", () => {
    it("marks the cover as not draggable", () => {
        // The row's own `draggable` binding does not reach a child that is
        // draggable by nature.
        const img = /<img[^>]*class="[^"]*album-art[^"]*"[^>]*>/.exec(read(TRACK_TITLE))?.[0];

        expect(img, "the cover <img> was not found — did its class change?").toBeTruthy();
        expect(img).toMatch(/draggable="false"/);
    });

    it("gates the dragstart handler on the same flag as the draggable binding", () => {
        const source = read(SONG_ITEM);
        const handler = /function onDragStart\([^)]*\)\s*\{([\s\S]*?)\n\}/.exec(source)?.[1];

        expect(handler, "onDragStart was not found").toBeTruthy();
        // Anything draggable that lands in this row later is covered by the
        // guard on the emitter, not by remembering to mark it.
        expect(handler).toMatch(/if\s*\(!props\.droppable\)\s*\{/);

        // ⚠️ And it CANCELS the event. A bare `return` withholds the payload
        // while the native drag runs on: rows paint their insertion line and
        // the drop is discarded — indistinguishable from a working drag until
        // you let go.
        const guard = /if\s*\(!props\.droppable\)\s*\{([\s\S]*?)\}/.exec(handler!)?.[1];
        expect(guard, "the droppable guard is not a block").toBeTruthy();
        expect(guard).toMatch(/e\.preventDefault\(\)/);
    });
});

describe("a drop target refuses an index from another list", () => {
    it.each(DROP_TARGETS)("%s checks the source before it moves anything", path => {
        const source = read(path);
        const handler = /function onTrackDropped\([\s\S]*?\n\}/.exec(source)?.[0];

        expect(handler, `onTrackDropped was not found in ${path}`).toBeTruthy();

        // The check has to come before the first mutation, not after it — a
        // guard below the move is a guard that already happened.
        const guard = /if\s*\(source\s*!==\s*dropSources\.\w+\)\s*return/.exec(handler!);
        expect(guard, `${path} does not reject a foreign drop source`).toBeTruthy();

        const move = handler!.search(/resolveMove|resolveQueueMove|moveTrack/);
        if (move > -1) {
            expect(guard!.index, `${path} checks the source AFTER moving`).toBeLessThan(move);
        }
    });

    it("names the argument, so an unused one cannot hide behind an underscore", () => {
        // `_source` is how this went unnoticed: the parameter was received and
        // the leading underscore made "unused" look deliberate to both the
        // linter and the reader.
        for (const path of DROP_TARGETS) {
            expect(read(path), `${path} still takes the drop source as _source`).not.toMatch(
                /function onTrackDropped\(\s*_source/
            );
        }
    });
});
