/**
 * Keeping shuffle's bookkeeping pointing at the same TRACKS while the queue
 * around it is edited.
 *
 * Permanent shuffle stores two things, and both are **absolute indexes into
 * the tracklist**:
 *
 *   - `shuffleNextIndex` — the pre-rolled target. `queue.nextindex` returns it,
 *     so it drives the next-track audio preload and the group broadcast.
 *   - `shuffleRecent`    — the history. `queue.previndex` reads it, and
 *     `pickShuffleIndex` uses it as the avoid-list for the next roll.
 *
 * Every splice of the tracklist renumbers the rows underneath them. Nothing
 * about that is visible from the shuffle state itself: the numbers stay valid,
 * they just quietly start naming different tracks. The symptom is never an
 * error — it is the wrong song, which is why this arithmetic lives in pure
 * functions with tests rather than inline in the stores.
 *
 * These deliberately RE-POINT rather than re-roll. A re-roll would discard a
 * target whose audio is already preloaded and change what plays next every
 * time somebody queues or removes a row — the very thing `rollShuffleNext`
 * exists to keep from happening (see the note on `queue.nextindex` about why
 * randomness never happens on read).
 */

/**
 * Rows were inserted at `from`. Everything at or after it moved back by
 * `count`; an index landing exactly on `from` is pushed down too, because the
 * new rows take its slot.
 */
export function shiftAfterInsert(index: number, from: number, count: number): number {
    if (count <= 0) return index
    return from <= index ? index + count : index
}

/**
 * One row at `removed` is gone.
 *
 * Returns `null` for the removed row itself — that index no longer names
 * anything, and the caller has to decide what that means. For the pre-rolled
 * target it means "roll again"; for a history entry it means "forget it".
 * Collapsing it to a neighbour instead would silently hand back a track the
 * picker never chose.
 */
export function shiftAfterRemove(index: number, removed: number): number | null {
    if (index === removed) return null
    return index > removed ? index - 1 : index
}

/**
 * A row moved from `from` to `finalIndex` (post-splice index, the one
 * `resolveQueueMove` returns — not the drop gap).
 *
 * Same four cases as the playing track in `resolveQueueMove`, and for the same
 * reason: only the client knows whether the dragged row passed *over* the index
 * being tracked.
 */
export function remapAfterMove(index: number, from: number, finalIndex: number): number {
    if (index === from) return finalIndex
    if (from < index && finalIndex >= index) return index - 1
    if (from > index && finalIndex <= index) return index + 1
    return index
}
