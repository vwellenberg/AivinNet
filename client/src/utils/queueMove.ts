/**
 * Do two track lists agree, track for track, over the closed index range
 * [lo, hi]?
 *
 * This is what decides whether a reorder made on one list may be replayed on the
 * other by index. The two lists are legitimately different LENGTHS — a playlist
 * page holds only what it has paginated in, while the queue built from it holds
 * everything — so comparing lengths answers the wrong question and rejects the
 * normal case. What matters is only the stretch the move actually touches.
 *
 * False when either list is too short to cover the range: an index that does not
 * exist cannot be shown to agree.
 */
export function rangeAligns(
    a: { trackhash: string }[],
    b: { trackhash: string }[],
    lo: number,
    hi: number
): boolean {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return false
    if (lo < 0 || hi < lo) return false
    if (a.length <= hi || b.length <= hi) return false

    for (let i = lo; i <= hi; i++) {
        if (a[i]?.trackhash === undefined) return false
        if (a[i].trackhash !== b[i]?.trackhash) return false
    }

    return true
}

export interface ResolvedQueueMove {
    /** Index the moved track ends up at, after the splice. */
    finalIndex: number
    /** Where the track that is currently playing sits once the move is applied. */
    currentindex: number
}

/**
 * Work out a queue reorder: where the dragged track lands, and where the
 * *playing* track ends up once it has landed.
 *
 * `to` follows the same convention as everywhere else in the app (SongItem,
 * `playlistMove.ts`): it is the *gap* the row was dropped into, i.e. the target
 * row's index when dropped on its top half and `index + 1` on its bottom half.
 * That is one larger than the final index when moving down, which is why
 * `finalIndex` corrects for it.
 *
 * The second half is the part a server cannot do for us. Only this client knows
 * whether the moved row passed *over* the playing track, and the playing track
 * must keep playing — a reorder is not a track change. Four cases:
 *
 *   - the playing track is the one being moved  -> it travels with it
 *   - a track from above it lands at or below it -> everything shifts up by one
 *   - a track from below it lands at or above it -> everything shifts down by one
 *   - anything else                              -> untouched
 *
 * Returns null when the move would not change anything (or the indices are out
 * of range), so callers can bail before mutating or broadcasting.
 */
export function resolveQueueMove(
    length: number,
    from: number,
    to: number,
    currentindex: number
): ResolvedQueueMove | null {
    if (!Number.isInteger(from) || from < 0 || from >= length) return null
    if (!Number.isInteger(to) || to < 0 || to > length) return null

    const finalIndex = to > from ? to - 1 : to
    if (finalIndex === from) return null

    let current = currentindex

    if (from === currentindex) {
        current = finalIndex
    } else if (from < currentindex && finalIndex >= currentindex) {
        current = currentindex - 1
    } else if (from > currentindex && finalIndex <= currentindex) {
        current = currentindex + 1
    }

    return { finalIndex, currentindex: current }
}
