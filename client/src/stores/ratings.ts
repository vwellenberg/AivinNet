import { defineStore } from 'pinia'

import { clearTrackRating, setTrackRating } from '@/requests/rating'

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
 * back to the previous answer if the server refuses it.
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
            this.record(trackhash, rating)

            const ok = rating === null ? await clearTrackRating(trackhash) : await setTrackRating(trackhash, rating)

            if (!ok) {
                this.record(trackhash, previous)
            }

            return ok
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
