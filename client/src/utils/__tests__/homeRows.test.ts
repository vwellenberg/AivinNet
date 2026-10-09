import { describe, expect, it } from 'vitest'
import { chipItems } from '../homeRows'

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
