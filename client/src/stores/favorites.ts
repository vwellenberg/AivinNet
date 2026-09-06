import { defineStore } from 'pinia'

import { favType } from '@/enums'

/**
 * What a favourite toggle in this session decided, keyed by item — regardless
 * of which copy of the item the control that flipped it was holding.
 *
 * The app carries the same track as SEVERAL objects at once: the folder, album
 * or playlist page it is listed on, the queue it was played from, the search
 * results it was found in. They are not the same object — the folder page, for
 * one, refetches its full track list before handing it to the queue — so the
 * `is_favorite` field that ships with an item is a per-copy snapshot of what
 * the server said when THAT copy was loaded.
 *
 * Writing the flip into the copy that was clicked is therefore not enough, and
 * that is exactly what the player bar did: favouriting the playing track wrote
 * the queue's copy, while the row for the same track on screen kept its own
 * hollow heart until something remounted it.
 *
 * So the flip is recorded here, once, by `favoriteHandler` — the single write
 * path for every favourite toggle in the app — and any heart reads it in
 * preference to its own copy's field. Only what CHANGED is held (this is not a
 * cache of the library's favourites): an item nobody toggled falls back to the
 * flag it was loaded with.
 *
 * Recorded first and never invalidated, for the run of the tab. That is the
 * trade, and it is deliberate: the server is asked about the playing track on
 * every read of `queue.currenttrack`, so anything that let a later reply win
 * would put the original bug back — a heart that fills on click and empties a
 * moment later. What it costs is that un-favouriting the same track from
 * ANOTHER tab or device stays invisible here until the page is reloaded. The
 * app has no favourite events to listen for; when it grows some, they belong
 * here, writing through `record` like every other answer.
 *
 * Not persisted, and it must not be: it is the session's memory of its own
 * clicks, and the durable answer already lives on the server (and, for the
 * queue, in the tracklist `favoriteHandler` writes alongside it).
 */
export default defineStore('favorites', {
    state: () => ({
        // `${type}:${itemhash}` -> is_favorite. A Map rather than an object so
        // a hash can never collide with a prototype key, and because Vue tracks
        // Map reads per key — a row only re-renders when ITS hash flips.
        flips: new Map<string, boolean>(),
    }),
    actions: {
        record(type: favType, itemhash: string, is_favorite: boolean) {
            this.flips.set(`${type}:${itemhash}`, is_favorite)
        },
    },
    getters: {
        /**
         * The recorded answer for an item, or `undefined` if it was never
         * toggled here. A getter that RETURNS a function on purpose: pinia
         * caches a getter's value, and one value cannot serve every hash.
         */
        flag: state => (type: favType, itemhash: string) => state.flips.get(`${type}:${itemhash}`),
    },
})
