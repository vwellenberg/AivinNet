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

    return candidates[draw(candidates.length, random)]
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
 * shuffle above), keeping the song playing on row `avoidFront` off the front.
 *
 * Playback restarts at index 0 right after, so the front row is what plays
 * next — and a shuffle that restarts the song already playing at 0:00 is the
 * one outcome nobody presses that button for. That is about the SONG, not the
 * row: the same track queued twice would restart just the same, so `songOf`
 * says which rows hold the same one.
 *
 * Every other order stays equally likely: a uniform shuffle, and if it puts
 * the playing song first, that row trades places with a uniformly drawn row
 * holding a different one. Solo and the group seam both call this, so the two
 * cannot drift apart again (see `.claude/rules/device-sync.md`).
 *
 * @param items       the queue in its current order (left untouched)
 * @param avoidFront  the row playing now
 * @param songOf      what a row plays — equal values are the same song
 * @param random      () => [0, 1) — injectable for tests
 */
export function shuffleAvoidingFront<T>(
    items: readonly T[],
    avoidFront: number,
    songOf: (item: T) => unknown,
    random: () => number = Math.random
): T[] {
    const order = items.map((_, i) => i)

    for (let i = order.length - 1; i > 0; i--) {
        const j = draw(i + 1, random)
        ;[order[i], order[j]] = [order[j], order[i]]
    }

    // A stale index (an emptied queue keeps `currentindex` 0) names no row,
    // so there is no song to keep off the front — and none to read.
    if (avoidFront >= 0 && avoidFront < items.length) {
        const playing = songOf(items[avoidFront])
        const holdsPlayingSong = (row: number) => songOf(items[row]) === playing

        if (holdsPlayingSong(order[0])) {
            const others: number[] = []
            for (let at = 1; at < order.length; at++) {
                if (!holdsPlayingSong(order[at])) others.push(at)
            }

            // A queue of nothing but this song has no other front to offer.
            if (others.length > 0) {
                const swap = others[draw(others.length, random)]
                ;[order[0], order[swap]] = [order[swap], order[0]]
            }
        }
    }

    return order.map(i => items[i])
}

/** A uniform integer in [0, n) — clamped, because `random` may return exactly 1. */
function draw(n: number, random: () => number): number {
    return Math.min(n - 1, Math.floor(random() * n))
}
