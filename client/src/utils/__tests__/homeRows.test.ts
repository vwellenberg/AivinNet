import { describe, expect, it } from 'vitest'
import { chipItems, playButtonLabel } from '../homeRows'

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

describe('playButtonLabel', () => {
    it('says what the row plays where "Play all" would be wrong', () => {
        expect(playButtonLabel('because_you_listened')).toBe('Play mix')
        expect(playButtonLabel('on_this_day')).toBe('Play that day')
    })

    it('says "Play all" for every other playable row', () => {
        expect(playButtonLabel('on_repeat')).toBe('Play all')
        expect(playButtonLabel('forgotten_favorites')).toBe('Play all')
        expect(playButtonLabel(undefined)).toBe('Play all')
    })

    it('reads no inherited names', () => {
        expect(playButtonLabel('constructor')).toBe('Play all')
    })
})
