import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// --- mocks for the store's side-effecting deps ------------------------------
const getAlbum = vi.fn()

vi.mock('@/requests/album', () => ({
    getAlbum: (...args: any[]) => getAlbum(...args),
    getAlbumsFromArtist: vi.fn(),
    getAlbumVersions: vi.fn(),
    getSimilarAlbums: vi.fn(),
}))
vi.mock('@/utils/colortools/setColorsToStore', () => ({ default: vi.fn() }))
vi.mock('@/stores/content-width', () => ({ fetchCardCount: { value: 10 } }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { album: 'album' },
}))

import useAlbumStore from '../pages/album'

const mkTrack = (disc: number, track: number, title: string) => ({
    trackhash: `${disc}-${track}`,
    filepath: `/music/${disc}-${track}.mp3`,
    title,
    album: 'Two Discs',
    artists: [{ name: 'Band', artisthash: 'a1' }],
    albumartists: [{ name: 'Band', artisthash: 'a1' }],
    disc,
    track,
    duration: 100,
})

// Two discs, so the store synthesises two disc-bar pseudo-tracks.
const albumResponse = () => ({
    tracks: [
        mkTrack(1, 1, 'Opening Riff'),
        mkTrack(1, 2, 'Dark Matter'),
        mkTrack(2, 1, 'Dark Side Reprise'),
        mkTrack(2, 2, 'Closing Riff'),
    ],
    info: {
        albumhash: 'ah1',
        title: 'Two Discs',
        image: 'cover.webp?pathhash=abc',
        albumartists: [{ name: 'Band', artisthash: 'a1' }],
    },
    copyright: '',
    extra: {},
    stats: [],
    more_from: {},
    other_versions: [],
})

async function loadedStore() {
    getAlbum.mockResolvedValue(albumResponse())
    const store = useAlbumStore()
    await store.fetchTracksAndArtists('ah1')
    return store
}

describe('album store find', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getAlbum.mockReset()
    })

    it('with no query the list keeps its disc bars between the discs', async () => {
        const store = await loadedStore()

        const discBars = store.tracks.filter(t => t.is_album_disc_number)
        expect(discBars).toHaveLength(2)
        expect(store.tracks).toHaveLength(6)
    })

    it('under a query only matching tracks remain, never a disc bar (guard; Fuse does not match bars)', async () => {
        const store = await loadedStore()

        store.query = 'dark'
        const tracks = store.tracks

        expect(tracks.some(t => t.is_album_disc_number)).toBe(false)
        expect(tracks.map(t => t.title)).toEqual(expect.arrayContaining(['Dark Matter', 'Dark Side Reprise']))
        expect(tracks.every(t => /dark/i.test(t.title))).toBe(true)
    })

    it('a filtered row keeps the master_index of its track, so it plays the right one', async () => {
        const store = await loadedStore()

        // srcTracks order is disc 1 then disc 2: "Dark Side Reprise" is index 2.
        const srcIndex = store.srcTracks.findIndex(t => t.title === 'Dark Side Reprise')
        expect(srcIndex).toBe(2)

        store.query = 'reprise'
        const [match] = store.tracks

        expect(match.title).toBe('Dark Side Reprise')
        expect(match.master_index).toBe(srcIndex)
        expect(store.srcTracks[match.master_index as number].title).toBe('Dark Side Reprise')
    })

    it('a query with no match yields an empty list (the view shows the empty state)', async () => {
        const store = await loadedStore()

        store.query = 'zzzqqq'

        expect(store.tracks).toEqual([])
    })

    it('resetQuery clears the query and brings the disc bars back', async () => {
        const store = await loadedStore()

        store.query = 'dark'
        store.resetQuery()

        expect(store.query).toBe('')
        expect(store.tracks.filter(t => t.is_album_disc_number)).toHaveLength(2)
    })
})
