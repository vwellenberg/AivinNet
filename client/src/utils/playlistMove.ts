import { Track } from '@/interfaces'

export interface ResolvedMove {
    /** Index the moved track ends up at, after the splice. */
    finalIndex: number
    /** The track being moved. */
    trackhash: string
    /**
     * The track the moved one must sit in front of, or null when it lands at the
     * very end. This is the anchor the server needs — see resolveMove() below.
     */
    beforeTrackhash: string | null
    /**
     * Arguments for a second moveTrack() call that puts the row back where it
     * came from, for rolling the optimistic update back when the request fails.
     */
    undo: { from: number; to: number }
}

/**
 * Work out everything a drag-drop reorder needs, from the drop event's indices.
 *
 * `to` follows the convention SongItem emits: the *gap* the row was dropped into,
 * i.e. `track.index` when dropped on a row's top half and `track.index + 1` on its
 * bottom half. So `to` is one larger than the target row's index when moving down.
 * The store's moveTrack() mirrors that with `to > from ? to - 1 : to`.
 *
 * The result is anchor-based (a trackhash to land in front of) rather than a
 * position, on purpose: the view only holds the tracks it has paginated in and
 * never sees orphan hashes at all, so no index it computes is a valid index into
 * the server's stored list. A trackhash is unambiguous in both lists.
 *
 * Returns null when the move would not change anything.
 */
export function resolveMove(tracks: Track[], from: number, to: number): ResolvedMove | null {
    if (from < 0 || from >= tracks.length) return null
    if (to < 0 || to > tracks.length) return null

    const finalIndex = to > from ? to - 1 : to
    if (finalIndex === from) return null

    const moved = tracks[from]
    if (!moved?.trackhash) return null

    // The anchor is whatever ends up *after* the moved track. Read it from the
    // list with the track already pulled out, so moving down doesn't pick the
    // neighbour the moved track is displacing.
    const rest = tracks.filter((_, i) => i !== from)
    const anchor = rest[finalIndex]

    return {
        finalIndex,
        trackhash: moved.trackhash,
        beforeTrackhash: anchor?.trackhash ?? null,
        // moveTrack() splices to `to > from ? to - 1 : to`, so undoing a move
        // that went DOWN needs its target bumped by one to survive that same
        // adjustment; a move that went up does not.
        undo: { from: finalIndex, to: from > finalIndex ? from + 1 : from },
    }
}
