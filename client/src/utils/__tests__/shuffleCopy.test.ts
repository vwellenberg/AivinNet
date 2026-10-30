import { describe, expect, it } from 'vitest'

import { shuffledCopy } from '@/utils/shuffleCopy'

describe('shuffledCopy', () => {
    const tracks = ['a', 'b', 'c', 'd', 'e']

    it('returns every item exactly once, in a new order', () => {
        const out = shuffledCopy(tracks, () => 0.37)
        expect([...out].sort()).toEqual([...tracks].sort())
        expect(out).not.toBe(tracks)
    })

    it('leaves the input as it was', () => {
        shuffledCopy(tracks, () => 0.9)
        expect(tracks).toEqual(['a', 'b', 'c', 'd', 'e'])
    })

    it('follows the random source, so a fixed one gives a fixed order', () => {
        // Fisher-Yates with j = floor(r * (i + 1)), for i = 4, 3, 2, 1:
        //   r=0   -> j=0: swap 4,0   [e b c d a]
        //   r=0.5 -> j=2: swap 3,2   [e b d c a]
        //   r=0   -> j=0: swap 2,0   [d b e c a]
        //   r=0.99-> j=1: swap 1,1   [d b e c a]
        const picks = [0, 0.5, 0, 0.99]
        expect(shuffledCopy(tracks, () => picks.shift() ?? 0)).toEqual(['d', 'b', 'e', 'c', 'a'])
    })

    it('is empty for an empty list and keeps a single item', () => {
        expect(shuffledCopy([], () => 0.5)).toEqual([])
        expect(shuffledCopy(['x'], () => 0.5)).toEqual(['x'])
    })
})
