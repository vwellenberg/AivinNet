/**
 * How many tracks in a row may fail to load before the player stops skipping.
 *
 * Skipping one broken file is right: the rest of the queue plays. But when
 * the cause is not the file — a queue whose paths and hashes the server no
 * longer knows (after the metadata dialog retitled and renamed an album), a
 * dropped connection, an unmounted drive — EVERY track fails, and a skip per
 * failure runs through the whole queue in seconds, one red toast per track.
 * A few failures in a row are enough evidence to stop and say so.
 */
export const MAX_FAILED_IN_A_ROW = 3

/**
 * Counts load failures since the last track that loaded.
 *
 * Lives outside the player store because that store builds audio elements on
 * import and cannot be loaded under test.
 */
export function createSkipGuard(limit = MAX_FAILED_IN_A_ROW) {
    let failedInARow = 0

    return {
        /** A track failed to load. `true` = skip to the next one, `false` = stop. */
        failed(): boolean {
            failedInARow += 1
            if (failedInARow < limit) return true

            // Stopping ends the run: whatever the person starts next gets the
            // full allowance, or one broken file on a new album would stop
            // playback instead of being skipped.
            failedInARow = 0
            return false
        },
        /** A track loaded: whatever failed before was that file, not the queue. */
        loaded() {
            failedInARow = 0
        },
    }
}
