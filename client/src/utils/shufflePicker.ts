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
