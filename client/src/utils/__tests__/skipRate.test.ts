import { describe, expect, it } from 'vitest'

import type { SkipRow } from '@/requests/stats'
import { artistNames, countOf, percent } from '@/utils/skipRate'

const row: SkipRow = {
    trackhash: 'a1b2c3d4e5f60718',
    plays: 8,
    share: 0.625,
    skipped: 5,
    track: { trackhash: 'a1b2c3d4e5f60718', title: 'Blue', artists: [{ name: 'The Artist' }, { name: 'Guest' }] },
}

describe('skip rate formatting', () => {
    it('rounds a share to whole percent and reads a missing rate as a dash', () => {
        expect(percent(0.625)).toBe('63 %')
        expect(percent(0.3)).toBe('30 %')
        expect(percent(1)).toBe('100 %')
        expect(percent(null)).toBe('—')
        expect(percent(Number.NaN)).toBe('—')
    })

    it('joins the artists of a track', () => {
        expect(artistNames(row)).toBe('The Artist, Guest')
    })

    it('counts the kind asked for, out of the plays', () => {
        expect(countOf(row, 'skipped')).toBe('5 of 8 plays')
        expect(countOf({ ...row, finished: 2 }, 'finished')).toBe('2 of 8 plays')
    })

    it('reads a missing count as zero rather than "undefined"', () => {
        expect(countOf(row, 'finished')).toBe('0 of 8 plays')
    })
})
