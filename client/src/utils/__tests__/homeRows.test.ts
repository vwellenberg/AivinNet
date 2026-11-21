import { describe, expect, it } from 'vitest'
import { afterAlmostCompletePlay, chipItems, playButtonLabel, restOfAlbum, withCardAt, withoutCard } from '../homeRows'

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

describe('restOfAlbum', () => {
    const tracks = [{ trackhash: 'a/1' }, { trackhash: 'a/2' }, { trackhash: 'a/3' }]

    it('keeps the songs to go, in album order', () => {
        expect(restOfAlbum(tracks, ['a/3', 'a/1'])).toEqual([{ trackhash: 'a/1' }, { trackhash: 'a/3' }])
    })

    it('is the whole album without a rest, or with none of it left', () => {
        expect(restOfAlbum(tracks, undefined)).toBe(tracks)
        expect(restOfAlbum(tracks, [])).toBe(tracks)
        expect(restOfAlbum(tracks, ['b/9'])).toBe(tracks)
    })
})

// An "Almost complete" card (#529): the album, its songs still missing, and the caption.
describe('afterAlmostCompletePlay', () => {
    const pending = (albumhash: string, rest: string[]) => ({
        type: 'album',
        item: {
            albumhash,
            title: albumhash,
            image: `${albumhash}.webp?pathhash=p-${albumhash}`,
            help_text: `${rest.length} ${rest.length === 1 ? 'song' : 'songs'} to go`,
            home: { unheard: true, first_heard: 1790000000, missing: rest.length, rest },
        },
    })

    it('takes the last missing song out and the card goes', () => {
        const items = [pending('a', ['t1']), pending('b', ['t2', 't3'])]

        const after = afterAlmostCompletePlay(items, undefined, 't1')

        expect(after?.items).toEqual([pending('b', ['t2', 't3'])])
    })

    it('keeps a card with one of two missing songs left, counting down', () => {
        const items = [pending('a', ['t1', 't2'])]

        const after = afterAlmostCompletePlay(items, undefined, 't1')

        expect(after?.items).toHaveLength(1)
        const card = after!.items[0]
        expect(card.item.home).toEqual({ unheard: true, first_heard: 1790000000, missing: 1, rest: ['t2'] })
        expect(card.item.help_text).toBe('1 song to go')
    })

    it('says "songs" while more than one is left', () => {
        const items = [pending('a', ['t1', 't2', 't3'])]

        const after = afterAlmostCompletePlay(items, undefined, 't3')

        expect(after!.items[0].item.help_text).toBe('2 songs to go')
        expect(after!.items[0].item.home.rest).toEqual(['t1', 't2'])
    })

    it('returns null for a song no card waits for', () => {
        const items = [pending('a', ['t1'])]

        expect(afterAlmostCompletePlay(items, undefined, 'unrelated')).toBeNull()
        expect(afterAlmostCompletePlay([], undefined, 't1')).toBeNull()
    })

    it('applies to the chips too, and drops a chip left with fewer than two cards', () => {
        const items = [pending('a', ['t1', 't9'])]
        const chips = [
            { key: 'funk', label: 'funk rock', items: [pending('a', ['t1', 't9']), pending('f', ['t1']), pending('g', ['t5'])] },
            { key: 'solo', label: 'solo', items: [pending('a', ['t1', 't9'])] },
        ]

        const after = afterAlmostCompletePlay(items, chips, 't1')

        expect(after?.items[0].item.help_text).toBe('1 song to go')
        expect(after?.chips).toHaveLength(1)
        expect(after?.chips?.[0].key).toBe('funk')
        // 'f' had only t1 to go, so it is gone; 'a' and 'g' stay, so the chip has two.
        expect(after?.chips?.[0].items.map(c => c.item.albumhash)).toEqual(['a', 'g'])
    })

    it('does not change the lists it was given', () => {
        const items = [pending('a', ['t1', 't2']), pending('b', ['t1'])]
        const chips = [{ key: 'funk', label: 'funk rock', items: [pending('a', ['t1', 't2']), pending('b', ['t1'])] }]
        const snapshot = structuredClone({ items, chips })

        afterAlmostCompletePlay(items, chips, 't1')

        expect({ items, chips }).toEqual(snapshot)
        expect(items).toHaveLength(2)
    })
})
