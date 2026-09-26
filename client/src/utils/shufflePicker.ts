/**
 * Pick the next index for permanent shuffle ("random track" mode).
 *
 * Deliberately pure and RNG-injectable: the queue store must be able to roll a
 * value in an *action* and keep it in state, because `nextindex` is a computed
 * getter that also feeds the next-track audio preload and the group-session
 * `track_change` broadcast. Rolling inside the getter would make it return a
 * different index on every read.
 *
 * @param length   number of tracks in the queue
 * @param current  the index playing now (never picked again)
 * @param recent   recently played indices to avoid while there are alternatives
 * @param random   () => [0, 1) — injectable for tests
 */
export function pickShuffleIndex(
    length: number,
    current: number,
    recent: readonly number[] = [],
    random: () => number = Math.random
): number {
    if (length <= 0) return 0
    if (length === 1) return 0

    const excluded = new Set<number>([current, ...recent])

    // Build the candidate pool, dropping the most recent exclusions first when the
    // queue is too short to honour all of them. `current` is never a candidate as
    // long as anything else exists, so shuffle never repeats a track back to back.
    let candidates = allExcept(length, excluded)

    if (candidates.length === 0) {
        const keepCurrentOut = new Set<number>([current])
        candidates = allExcept(length, keepCurrentOut)
    }

    return candidates[Math.floor(random() * candidates.length)] ?? 0
}

function allExcept(length: number, excluded: Set<number>): number[] {
    const result: number[] = []

    for (let i = 0; i < length; i++) {
        if (!excluded.has(i)) result.push(i)
    }

    return result
}

/**
 * Append `index` to a bounded history of recently played indices (newest last).
 */
export function pushRecent(recent: readonly number[], index: number, limit: number): number[] {
    const next = recent.filter(i => i !== index)
    next.push(index)

    return next.slice(Math.max(0, next.length - limit))
}

/**
 * Shuffle the whole queue once (`queue.shuffleQueue`, as opposed to permanent
 * shuffle above), keeping the row at `avoidFront` out of the front.
 *
 * Both callers restart playback at index 0 right after, so the front row is
 * what plays next — and a shuffle that restarts the song already playing at
 * 0:00 is the one outcome nobody presses that button for. Every other order
 * stays equally likely: a uniform shuffle, and if it happens to put that row
 * first, the row trades places with a uniformly drawn other one.
 *
 * Solo (`tracklist.shuffleList`) and the group seam (`devicesync`, which sends
 * the new order as a queue-set) both come through here. The group path used to
 * keep its own copy, and it put the playing track FIRST: every device restarted
 * the song that was already on.
 *
 * Decided on rows, not values, so `items` can be tracks or trackhashes.
 *
 * @param items       the queue in its current order (left untouched)
 * @param avoidFront  index of the row playing now; omit for a plain shuffle
 * @param random      () => [0, 1) — injectable for tests
 */
export function shuffleAvoidingFront<T>(
    items: readonly T[],
    avoidFront?: number,
    random: () => number = Math.random
): T[] {
    const order = items.map((_, i) => i)

    for (let i = order.length - 1; i > 0; i--) {
        const j = draw(i + 1, random)
        ;[order[i], order[j]] = [order[j], order[i]]
    }

    if (order.length > 1 && order[0] === avoidFront) {
        const swap = 1 + draw(order.length - 1, random)
        ;[order[0], order[swap]] = [order[swap], order[0]]
    }

    return order.map(i => items[i])
}

/** A uniform integer in [0, n) — clamped, because `random` may return exactly 1. */
function draw(n: number, random: () => number): number {
    return Math.min(n - 1, Math.floor(random() * n))
}
