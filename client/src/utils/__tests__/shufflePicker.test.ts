import { describe, expect, it } from 'vitest'

import { pickShuffleIndex, pushRecent, shuffleAvoidingFront } from '@/utils/shufflePicker'

/** Deterministic RNG: walks the given values, then repeats the last one. */
const rng = (...values: number[]) => {
    let i = 0
    return () => values[Math.min(i++, values.length - 1)]
}

describe('pickShuffleIndex', () => {
    it('never returns the current index', () => {
        for (let current = 0; current < 5; current++) {
            for (let r = 0; r < 20; r++) {
                const picked = pickShuffleIndex(5, current, [], rng(r / 20))
                expect(picked).not.toBe(current)
            }
        }
    })

    it('avoids recently played indices', () => {
        // Queue of 5, current 0, recent 1 and 2 -> only 3 and 4 are candidates.
        const picked = new Set<number>()
        for (let r = 0; r < 20; r++) picked.add(pickShuffleIndex(5, 0, [1, 2], rng(r / 20)))
        expect([...picked].sort()).toEqual([3, 4])
    })

    it('reaches every other track over many draws', () => {
        const seen = new Set<number>()
        for (let r = 0; r < 100; r++) seen.add(pickShuffleIndex(6, 2, [], rng(r / 100)))
        expect([...seen].sort()).toEqual([0, 1, 3, 4, 5])
    })

    it('drops the history exclusion when the queue is too short to honour it', () => {
        // Queue of 3, current 0, recent covers both alternatives. Rather than
        // returning the current track, fall back to the non-current candidates.
        const picked = pickShuffleIndex(3, 0, [1, 2], rng(0.9))
        expect([1, 2]).toContain(picked)
    })

    it('returns the only track for a one-track queue', () => {
        expect(pickShuffleIndex(1, 0, [], rng(0.5))).toBe(0)
    })

    it('returns 0 for an empty queue instead of a negative index', () => {
        expect(pickShuffleIndex(0, 0, [], rng(0.5))).toBe(0)
    })

    it('alternates on a two-track queue', () => {
        expect(pickShuffleIndex(2, 0, [], rng(0.99))).toBe(1)
        expect(pickShuffleIndex(2, 1, [], rng(0.99))).toBe(0)
    })

    it('never returns an out-of-range index', () => {
        for (let length = 1; length <= 8; length++) {
            for (let r = 0; r < 30; r++) {
                const picked = pickShuffleIndex(length, 0, [], rng(r / 30))
                expect(picked).toBeGreaterThanOrEqual(0)
                expect(picked).toBeLessThan(length)
            }
        }
    })

    it('handles a random() that returns exactly 1 (some polyfills do)', () => {
        const picked = pickShuffleIndex(4, 0, [], () => 1)
        expect(picked).toBeGreaterThanOrEqual(0)
        expect(picked).toBeLessThan(4)
    })
})

describe('pushRecent', () => {
    it('appends the newest index last', () => {
        expect(pushRecent([1, 2], 3, 10)).toEqual([1, 2, 3])
    })

    it('caps the history at the limit, dropping the oldest', () => {
        expect(pushRecent([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    })

    it('moves a repeated index to the newest slot instead of duplicating it', () => {
        expect(pushRecent([1, 2, 3], 2, 10)).toEqual([1, 3, 2])
    })

    it('does not mutate the input', () => {
        const recent = [1, 2]
        pushRecent(recent, 3, 10)
        expect(recent).toEqual([1, 2])
    })
})

// The one-shot shuffle of the whole queue. Both callers restart at index 0
// afterwards, so the front row is what plays next.
describe('shuffleAvoidingFront', () => {
    const ROWS = ['a', 'b', 'c', 'd', 'e', 'f']

    it('never puts the playing row first', () => {
        for (let playing = 0; playing < ROWS.length; playing++) {
            for (let r = 0; r < 30; r++) {
                expect(shuffleAvoidingFront(ROWS, playing, rng(r / 30))[0]).not.toBe(ROWS[playing])
            }
        }
    })

    it('keeps every row and leaves the input alone', () => {
        const rows = ROWS.slice()

        const shuffled = shuffleAvoidingFront(rows, 2, rng(0.3, 0.8, 0.1, 0.6, 0.9))

        expect(shuffled.slice().sort()).toEqual(ROWS)
        expect(rows).toEqual(ROWS)
    })

    // Every dice outcome for three rows, playing row "y": two Fisher–Yates
    // draws (3 × 2 ways), then the swap draw (2 ways) that only a front
    // collision reads — twelve equally likely paths. Each of the four orders
    // without "y" in front has to come out of exactly three of them.
    // A swap that always picks the same row would pass the test above and
    // still bring the playing track straight back as the SECOND song.
    it('leaves every other order equally likely', () => {
        const counts: Record<string, number> = {}

        for (const a of [0, 1, 2]) {
            for (const b of [0, 1]) {
                for (const c of [0, 1]) {
                    const dice = rng((a + 0.5) / 3, (b + 0.5) / 2, (c + 0.5) / 2)
                    const order = shuffleAvoidingFront(['x', 'y', 'z'], 1, dice).join('')
                    counts[order] = (counts[order] ?? 0) + 1
                }
            }
        }

        expect(counts).toEqual({ xyz: 3, xzy: 3, zxy: 3, zyx: 3 })
    })

    it('leaves a single row where it is', () => {
        expect(shuffleAvoidingFront(['only'], 0, rng(0.5))).toEqual(['only'])
    })

    it('returns an empty queue as it is', () => {
        expect(shuffleAvoidingFront([], 0, rng(0.5))).toEqual([])
    })

    it('handles a random() that returns exactly 1 (some polyfills do)', () => {
        const shuffled = shuffleAvoidingFront(['a', 'b', 'c', 'd'], 0, () => 1)

        expect(shuffled.slice().sort()).toEqual(['a', 'b', 'c', 'd'])
        expect(shuffled[0]).not.toBe('a')
    })
})
