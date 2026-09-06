import { describe, expect, it } from 'vitest'

import { pickShuffleIndex, pushRecent } from '@/utils/shufflePicker'

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
