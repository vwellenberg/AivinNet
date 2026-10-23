import { describe, expect, it } from 'vitest'
import { chipItems, playButtonLabel, withCardAt, withoutCard } from '../homeRows'

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
        expect(playButtonLabel('almost_complete')).toBe('Play the rest')
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

// "Not interested" (#531): the row without the card, and the card put back.
describe('withoutCard', () => {
    const artist = (artisthash: string) => ({ type: 'artist', item: { artisthash } })

    it('takes the card out of the row and out of every chip', () => {
        const chips = [
            { key: 'funk', label: 'funk rock', items: [album('a'), album('f'), album('g')] },
            { key: 'jazz', label: 'jazz', items: [album('j'), album('k')] },
        ]

        const left = withoutCard([album('a'), album('b')], chips, 'a')

        expect(left.items).toEqual([album('b')])
        expect(left.chips).toEqual([
            { key: 'funk', label: 'funk rock', items: [album('f'), album('g')] },
            { key: 'jazz', label: 'jazz', items: [album('j'), album('k')] },
        ])
    })

    it('drops a chip left with one card, which is no choice, and one left with none', () => {
        const chips = [
            { key: 'funk', label: 'funk rock', items: [album('a'), album('f')] },
            { key: 'solo', label: 'solo', items: [album('a')] },
        ]

        expect(withoutCard([album('a')], chips, 'a').chips).toEqual([])
    })

    it('finds an artist by its artist hash', () => {
        expect(withoutCard([artist('p'), artist('m')], undefined, 'p')).toEqual({ items: [artist('m')], chips: undefined })
    })

    it('does not change the lists it was given', () => {
        const row = [album('a'), album('b')]
        withoutCard(row, undefined, 'a')
        expect(row).toHaveLength(2)
    })
})

describe('withCardAt', () => {
    it('puts the card back where it stood', () => {
        expect(withCardAt([album('a'), album('c')], album('b'), 1)).toEqual([album('a'), album('b'), album('c')])
    })

    it('puts it at the end when the row got shorter meanwhile', () => {
        expect(withCardAt([album('a')], album('b'), 5)).toEqual([album('a'), album('b')])
    })

    it('does not add it twice', () => {
        const row = [album('a'), album('b')]
        expect(withCardAt(row, album('b'), 0)).toBe(row)
    })
})
