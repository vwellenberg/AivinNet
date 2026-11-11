import { defineStore } from 'pinia'

import { clearTrackRating, getAllTrackRatings, setTrackRating } from '@/requests/rating'

// The latest `rate` call per trackhash. Not state: nothing renders from it.
const latest = new Map<string, number>()
let calls = 0

/** Test helper: forget which call was the latest (module state outlives a fresh Pinia). */
export function __resetRatingsTestState() {
    latest.clear()
    calls = 0
}

/**
 * What a rating change in this session decided, keyed by trackhash (#777).
 *
 * The same track is held as several objects at once (the page it is listed on,
 * the queue it was played from), and each copy carries the `rating` it was
 * loaded with. Every rating control reads the answer here first, so a change
 * made on one copy shows on all of them. Like `stores/favorites.ts` this holds
 * only what CHANGED in this session; an untouched track falls back to the
 * `rating` it shipped with.
 *
 * `rate` is optimistic: the new value is recorded before the request, and put
 * back to the previous answer if the server refuses it — unless a newer change
 * to the same track was made meanwhile. Rating 4, then quickly 5, with the 4
 * refused after the 5 went out, rolled the 5 back to "unrated".
 *
 * `seed` fills in the user's ratings at app start. A queue restored from the
 * browser holds copies from before a rating (or before ratings existed), and
 * their `rating` would otherwise show until the track is loaded again.
 */
export default defineStore('ratings', {
    state: () => ({
        // trackhash -> rating, or null for "cleared". A Map so a row only
        // re-renders when ITS hash changes, and so a hash can never collide
        // with an object key.
        values: new Map<string, number | null>(),
    }),
    actions: {
        record(trackhash: string, rating: number | null) {
            this.values.set(trackhash, rating)
        },

        /**
         * Sets (1-5) or clears (null) the rating and returns whether the server kept it.
         * `fallback` is the rating the copy the control belongs to was loaded with.
         */
        async rate(trackhash: string, rating: number | null, fallback: number | null = null): Promise<boolean> {
            const previous = this.rating(trackhash, fallback)
            const call = ++calls
            latest.set(trackhash, call)
            this.record(trackhash, rating)

            const ok = rating === null ? await clearTrackRating(trackhash) : await setTrackRating(trackhash, rating)

            // Only the newest change may roll back: an older refusal arriving
            // after a newer change would otherwise undo the newer one.
            if (!ok && latest.get(trackhash) === call) {
                this.record(trackhash, previous)
            }

            return ok
        },

        /** Load the user's ratings once. A change made in this session wins over it. */
        async seed() {
            const all = await getAllTrackRatings()

            for (const [trackhash, rating] of Object.entries(all)) {
                if (!this.values.has(trackhash)) this.record(trackhash, rating)
            }
        },
    },
    getters: {
        /**
         * The rating for a track: the session's answer if it changed here, else `fallback`.
         * Returns a function on purpose — one cached getter value cannot serve every hash.
         */
        rating: state => (trackhash: string, fallback: number | null = null): number | null => {
            return state.values.has(trackhash) ? (state.values.get(trackhash) ?? null) : fallback
        },
    },
})
