import { describe, expect, it } from 'vitest'

import { Track } from '@/interfaces'
import { sortArtistTracks, totalSeconds } from '@/utils/artistTracks'

function t(title: string, album: string, extra: Partial<Track> = {}): Track {
    return {
        title,
        album,
        trackhash: title,
        disc: 1,
        track: 1,
        duration: 200,
        image: 'abc.webp?pathhash=1f2e3d',
        ...extra,
    } as Track
}

// In the server's order: most played first.
const fromServer = [
    t('Zebra', 'B Album', { year: 2001, track: 2 }),
    t('apple', 'A Album', { year: 2010, track: 3 }),
    t('Mango', 'A Album', { year: 2010, track: 1 }),
    t('Kiwi', 'C Album', { year: null, track: 1, duration: undefined }),
    t('Banana', 'B Album', { year: 2001, track: 1 }),
]

const titles = (list: Track[]) => list.map(x => x.title)

describe('sortArtistTracks', () => {
    it('keeps the server order for "Most played" and never mutates the input', () => {
        const before = titles(fromServer)
        expect(titles(sortArtistTracks(fromServer, 'plays'))).toEqual(before)
        sortArtistTracks(fromServer, 'title')
        expect(titles(fromServer)).toEqual(before)
    })

    it('sorts titles case-insensitively', () => {
        expect(titles(sortArtistTracks(fromServer, 'title'))).toEqual(['apple', 'Banana', 'Kiwi', 'Mango', 'Zebra'])
    })

    it('keeps an album together in track order', () => {
        expect(titles(sortArtistTracks(fromServer, 'album'))).toEqual(['Mango', 'apple', 'Banana', 'Zebra', 'Kiwi'])
    })

    it('puts the newest year first and tracks without a year last', () => {
        expect(titles(sortArtistTracks(fromServer, 'year'))).toEqual(['Mango', 'apple', 'Banana', 'Zebra', 'Kiwi'])
    })
})

describe('totalSeconds', () => {
    it('sums the durations and counts a missing one as 0', () => {
        expect(totalSeconds(fromServer)).toBe(800)
        expect(totalSeconds([])).toBe(0)
    })
})
