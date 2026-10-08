import { describe, expect, it } from 'vitest'
import { barHeights, chipItems } from '../homeRows'

const album = (albumhash: string) => ({ type: 'album', item: { albumhash } })

describe('chipItems', () => {
    const row = [album('a'), album('b')]
    const chips = [{ key: 'funk', label: 'funk rock', items: [album('f')] }]

    it('shows the row without a chip', () => {
        expect(chipItems(row, chips, null)).toBe(row)
    })

    it('shows the chip that is selected', () => {
        expect(chipItems(row, chips, 'funk')).toEqual([album('f')])
    })

    it('falls back to the row when the chip is gone', () => {
        expect(chipItems(row, chips, 'jazz')).toBe(row)
        expect(chipItems(row, undefined, 'funk')).toBe(row)
    })
})

describe('barHeights', () => {
    it('scales to the busiest week', () => {
        expect(barHeights([0, 5, 10])).toEqual([4, 50, 100])
    })

    it('keeps a single play visible next to many', () => {
        expect(barHeights([1, 40])).toEqual([12, 100])
    })

    it('copes with no plays at all', () => {
        expect(barHeights([0, 0])).toEqual([4, 4])
    })
})
