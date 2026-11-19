import { describe, expect, it } from 'vitest'

import { Track } from '@/interfaces'
import {
    SORT_DEFAULT_REVERSE,
    isViewShaped,
    noFilters,
    shapeTracks,
} from '@/utils/playlistView'

// Realistic backend shapes: image strings carry the ?pathhash= suffix, and an
// artist is an object, not a name. `added_at` is a unix time in seconds.
const mk = (n: number, over: Partial<Track> = {}): Track =>
    ({
        id: String(n),
        trackhash: `h${n}`,
        filepath: `/music/${n}.mp3`,
        title: `Track ${n}`,
        album: 'Album A',
        artists: [{ name: 'Artist A', image: 'a.webp?pathhash=abc', artisthash: 'a', trackcount: 1, albumcount: 1 }],
        albumartists: [],
        duration: 100,
        bitrate: 320,
        image: 'cover.webp?pathhash=xyz',
        track: n,
        disc: 1,
        index: n - 1,
        filetype: 'mp3',
        is_favorite: false,
        explicit: false,
        og_title: `Track ${n}`,
        og_album: 'Album A',
        playcount: 0,
        added_at: 1_700_000_000 + n,
        rating: null,
        ...over,
    }) as Track

const hashes = (tracks: Track[]) => tracks.map(t => t.trackhash)
const NONE = noFilters()

describe('filters', () => {
    const tracks = [
        mk(1, { playcount: 0 }),
        mk(2, { playcount: 3 }),
        mk(3, { playcount: undefined }), // a missing count is a track never played
        mk(4, { is_favorite: true }),
        mk(5, { rating: 5 }),
        mk(6, { rating: 4 }),
        mk(7, { rating: 3 }),
        mk(8, { rating: null }),
    ]

    it('unplayed keeps zero plays and a missing count, drops anything played', () => {
        const out = shapeTracks(tracks, '', false, { ...NONE, unplayed: true })
        expect(hashes(out)).toEqual(['h1', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8'])
    })

    it('favorites keeps only the favorited tracks', () => {
        const out = shapeTracks(tracks, '', false, { ...NONE, favorites: true })
        expect(hashes(out)).toEqual(['h4'])
    })

    it('rated 4+ keeps 4 and 5, drops 3, and treats an unrated track as 0', () => {
        const out = shapeTracks(tracks, '', false, { ...NONE, topRated: true })
        expect(hashes(out)).toEqual(['h5', 'h6'])
    })

    it('active chips combine with AND, each one narrowing the last', () => {
        // h4 is a favorite rated nothing; h5 is a favorite rated 5.
        const withFav = tracks.map(t => (t.trackhash === 'h5' ? { ...t, is_favorite: true } : t))

        expect(hashes(shapeTracks(withFav, '', false, { ...NONE, favorites: true }))).toEqual(['h4', 'h5'])
        expect(hashes(shapeTracks(withFav, '', false, { ...NONE, favorites: true, topRated: true }))).toEqual(['h5'])
        // h5 has no plays, so Unplayed keeps it: all three hold for h5 only.
        expect(hashes(shapeTracks(withFav, '', false, { unplayed: true, favorites: true, topRated: true }))).toEqual(['h5'])
        // Played once: out of Unplayed, even as a favorite rated 5.
        const played = withFav.map(t => (t.trackhash === 'h5' ? { ...t, playcount: 1 } : t))
        expect(shapeTracks(played, '', false, { unplayed: true, favorites: true, topRated: true })).toEqual([])
    })

    it('no chip active keeps every track', () => {
        expect(hashes(shapeTracks(tracks, '', false, NONE))).toHaveLength(tracks.length)
    })
})

describe('sort keys', () => {
    it('title sorts A to Z, and Z to A when reversed', () => {
        const tracks = [mk(1, { title: 'Charlie' }), mk(2, { title: 'alpha' }), mk(3, { title: 'Bravo' })]
        expect(hashes(shapeTracks(tracks, 'title', false, NONE))).toEqual(['h2', 'h3', 'h1'])
        expect(hashes(shapeTracks(tracks, 'title', true, NONE))).toEqual(['h1', 'h3', 'h2'])
    })

    it('natural numbers: "Track 2" comes before "Track 10"', () => {
        const tracks = [mk(1, { title: 'Track 10' }), mk(2, { title: 'Track 2' })]
        expect(hashes(shapeTracks(tracks, 'title', false, NONE))).toEqual(['h2', 'h1'])
    })

    it('artist uses the first artist, both directions', () => {
        const tracks = [
            mk(1, { artists: [{ name: 'Zed', image: '', artisthash: 'z', trackcount: 1, albumcount: 1 }] }),
            mk(2, { artists: [{ name: 'Amy', image: '', artisthash: 'a', trackcount: 1, albumcount: 1 }] }),
            mk(3, { artists: [] }),
        ]
        expect(hashes(shapeTracks(tracks, 'artist', false, NONE))).toEqual(['h3', 'h2', 'h1'])
        expect(hashes(shapeTracks(tracks, 'artist', true, NONE))).toEqual(['h1', 'h2', 'h3'])
    })

    it('album sorts by album name, both directions', () => {
        const tracks = [mk(1, { album: 'Beta' }), mk(2, { album: 'Alpha' })]
        expect(hashes(shapeTracks(tracks, 'album', false, NONE))).toEqual(['h2', 'h1'])
        expect(hashes(shapeTracks(tracks, 'album', true, NONE))).toEqual(['h1', 'h2'])
    })

    it('duration: short to long, and long to short when reversed', () => {
        const tracks = [mk(1, { duration: 200 }), mk(2, { duration: 90 }), mk(3, { duration: 150 })]
        expect(hashes(shapeTracks(tracks, 'duration', false, NONE))).toEqual(['h2', 'h3', 'h1'])
        expect(hashes(shapeTracks(tracks, 'duration', true, NONE))).toEqual(['h1', 'h3', 'h2'])
    })

    it('playcount: most played first when reversed, least first otherwise', () => {
        const tracks = [mk(1, { playcount: 2 }), mk(2, { playcount: 9 }), mk(3, { playcount: undefined })]
        expect(hashes(shapeTracks(tracks, 'playcount', true, NONE))).toEqual(['h2', 'h1', 'h3'])
        expect(hashes(shapeTracks(tracks, 'playcount', false, NONE))).toEqual(['h3', 'h1', 'h2'])
    })

    it('added: newest first when reversed, oldest first otherwise', () => {
        const tracks = [mk(1, { added_at: 100 }), mk(2, { added_at: 300 }), mk(3, { added_at: 200 })]
        expect(hashes(shapeTracks(tracks, 'added', true, NONE))).toEqual(['h2', 'h3', 'h1'])
        expect(hashes(shapeTracks(tracks, 'added', false, NONE))).toEqual(['h1', 'h3', 'h2'])
    })

    it('a track without added_at goes last, in BOTH directions', () => {
        const tracks = [mk(1, { added_at: null }), mk(2, { added_at: 100 }), mk(3, { added_at: 300 })]
        expect(hashes(shapeTracks(tracks, 'added', true, NONE))).toEqual(['h3', 'h2', 'h1'])
        expect(hashes(shapeTracks(tracks, 'added', false, NONE))).toEqual(['h2', 'h3', 'h1'])
    })

    it('ties keep the playlist order, in both directions', () => {
        // Same album on every row: the sort has nothing to decide, so the
        // playlist's own order must survive — flipping the array would not.
        const tracks = [mk(1), mk(2), mk(3), mk(4)]
        expect(hashes(shapeTracks(tracks, 'album', false, NONE))).toEqual(['h1', 'h2', 'h3', 'h4'])
        expect(hashes(shapeTracks(tracks, 'album', true, NONE))).toEqual(['h1', 'h2', 'h3', 'h4'])
    })

    it('an empty key keeps the incoming order and ignores reverse', () => {
        const tracks = [mk(3), mk(1), mk(2)]
        expect(hashes(shapeTracks(tracks, '', false, NONE))).toEqual(['h3', 'h1', 'h2'])
        expect(hashes(shapeTracks(tracks, '', true, NONE))).toEqual(['h3', 'h1', 'h2'])
    })

    it('never mutates the input array', () => {
        const tracks = [mk(3, { title: 'C' }), mk(1, { title: 'A' }), mk(2, { title: 'B' })]
        const before = hashes(tracks)
        const out = shapeTracks(tracks, 'title', false, NONE)
        expect(hashes(tracks)).toEqual(before)
        expect(out).not.toBe(tracks)
    })

    it('filtering and sorting together keep each track object identity', () => {
        const tracks = [mk(1, { is_favorite: true }), mk(2), mk(3, { is_favorite: true })]
        const out = shapeTracks(tracks, 'duration', false, { ...NONE, favorites: true })
        expect(out[0]).toBe(tracks[0])
        expect(out[1]).toBe(tracks[2])
    })
})

describe('defaults and view state', () => {
    it('added and playcount start newest/most-played first, the rest A to Z or short first', () => {
        expect(SORT_DEFAULT_REVERSE).toEqual({
            title: false,
            artist: false,
            album: false,
            added: true,
            duration: false,
            playcount: true,
        })
    })

    it('a view is shaped by a sort or any chip, and not by nothing', () => {
        expect(isViewShaped('', NONE)).toBe(false)
        expect(isViewShaped('title', NONE)).toBe(true)
        expect(isViewShaped('', { ...NONE, topRated: true })).toBe(true)
        expect(isViewShaped('', { ...NONE, unplayed: true })).toBe(true)
        expect(isViewShaped('', { ...NONE, favorites: true })).toBe(true)
    })

    it('noFilters returns a fresh object each time', () => {
        const a = noFilters()
        a.favorites = true
        expect(noFilters().favorites).toBe(false)
    })
})
