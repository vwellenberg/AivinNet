import { beforeEach, describe, expect, it, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// --- mocks for the store's side-effecting deps ------------------------------
const getPlaylist = vi.fn()

vi.mock('@/requests/playlists', () => ({
    getPlaylist: (...args: any[]) => getPlaylist(...args),
    removeBannerImage: vi.fn(),
}))
vi.mock('@/utils/colortools/setColorsToStore', () => ({ default: vi.fn() }))
// Fixed, generous limit so small playlists are considered fully loaded.
vi.mock('@/stores/content-width', () => ({ track_limit: { value: 50 } }))
vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'other' } } },
    Routes: { playlist: 'playlist' },
}))

import usePlaylistStore from '../pages/playlist'

const mkTrack = (n: number) => ({
    trackhash: `h${n}`,
    filepath: `/music/${n}.mp3`,
    title: `Track ${n}`,
    album: 'Live Sesh and Xtra Songs',
    artists: [],
    albumartists: [],
    duration: 100,
})

const mkInfo = (count: number) => ({
    id: 59,
    name: 'Louis Cole',
    count,
    settings: { banner_pos: 50 },
    has_image: false,
    images: [],
    image: 'cover.webp',
})

describe('playlist store fetchAll', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getPlaylist.mockReset()
    })

    it('fresh load sets allTracks and marks allLoaded when a page is shorter than the limit', async () => {
        // 8 trackhashes, only 7 resolve (one orphan) -> count 8, tracks 7
        const tracks = [1, 2, 3, 4, 5, 6, 7].map(mkTrack)
        getPlaylist.mockResolvedValue({ info: mkInfo(8), tracks })

        const store = usePlaylistStore()
        await store.fetchAll(59)

        expect(store.allTracks).toHaveLength(7)
        expect(store.allLoaded).toBe(true)
        expect(store.info.count).toBe(8)
    })

    it('does NOT trigger the play-path re-fetch once fully loaded (gate would be false)', async () => {
        const tracks = [1, 2, 3, 4, 5, 6, 7].map(mkTrack)
        getPlaylist.mockResolvedValue({ info: mkInfo(8), tracks })

        const store = usePlaylistStore()
        await store.fetchAll(59)

        // allLoaded short-circuits playFromPlaylistPage / usePlayFrom, so the
        // buggy re-fetch never runs for an orphan playlist (the 8th hash is an
        // orphan but all 8 hash-windows were requested in the single page).
        expect(store.allLoaded).toBe(true)
        expect(getPlaylist).toHaveBeenCalledTimes(1)
    })

    it('large playlist with an orphan in the first page keeps loading (allLoaded stays false)', async () => {
        const store = usePlaylistStore()

        // 100 stored hashes; first page (limit 50) resolves to only 49 (one
        // orphan inside the window). A short page must NOT be read as "done".
        const page1 = Array.from({ length: 49 }, (_, i) => mkTrack(i))
        getPlaylist.mockResolvedValueOnce({ info: mkInfo(100), tracks: page1 })
        await store.fetchAll(59)
        expect(store.allTracks).toHaveLength(49)
        expect(store.allLoaded).toBe(false)

        // Next page advances by the trackhash cursor (50), not the resolved
        // count (49), so no window is skipped or re-requested.
        const page2 = Array.from({ length: 50 }, (_, i) => mkTrack(50 + i))
        getPlaylist.mockResolvedValueOnce({ info: mkInfo(100), tracks: page2 })
        await store.fetchAll(59)
        expect(store.allTracks).toHaveLength(99)
        expect(store.allLoaded).toBe(true)
        expect(getPlaylist.mock.calls[1][2]).toBe(50) // start = trackhash cursor
    })

    it('play-path fetchAll(true) REPLACES the list and never duplicates a track', async () => {
        const tracks = [1, 2, 3, 4, 5, 6, 7].map(mkTrack)
        getPlaylist.mockResolvedValue({ info: mkInfo(8), tracks })

        const store = usePlaylistStore()
        await store.fetchAll(59) // fresh load -> 7
        await store.fetchAll(59, false, true) // "load everything" pass

        expect(store.allTracks).toHaveLength(7)
        const hashes = store.allTracks.map(t => t.trackhash)
        expect(new Set(hashes).size).toBe(7) // no duplicates
        // Last call must paginate from 0 with -1, not from allTracks.length
        const lastArgs = getPlaylist.mock.calls.at(-1)
        expect(lastArgs?.[2]).toBe(0)
        expect(lastArgs?.[3]).toBe(-1)
    })

    it('incremental append dedupes by trackhash', async () => {
        const store = usePlaylistStore()

        getPlaylist.mockResolvedValueOnce({ info: mkInfo(6), tracks: [1, 2, 3].map(mkTrack) })
        await store.fetchAll(59) // fresh load -> [1,2,3]

        // Incremental page that overlaps (track 3 already present) + a new one
        getPlaylist.mockResolvedValueOnce({ info: mkInfo(6), tracks: [3, 4].map(mkTrack) })
        await store.fetchAll(59) // not fresh, not fetchAll -> append branch

        const hashes = store.allTracks.map(t => t.trackhash)
        expect(hashes).toEqual(['h1', 'h2', 'h3', 'h4'])
        expect(new Set(hashes).size).toBe(hashes.length)
    })

    it('tracks getter yields contiguous indices (no gap) for a deduped list', async () => {
        const tracks = [1, 2, 3, 4, 5, 6, 7].map(mkTrack)
        getPlaylist.mockResolvedValue({ info: mkInfo(8), tracks })

        const store = usePlaylistStore()
        await store.fetchAll(59)

        const indices = store.tracks.map(t => t.index)
        expect(indices).toEqual([0, 1, 2, 3, 4, 5, 6])
        // The scroller keys by track.index -> all keys unique, no collision
        expect(new Set(indices).size).toBe(indices.length)
    })
})

describe('playlist store moveTrack', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getPlaylist.mockReset()
    })

    const hashes = () => usePlaylistStore().allTracks.map(t => t.trackhash)

    const seed = (n: number) => {
        const store = usePlaylistStore()
        store.allTracks = Array.from({ length: n }, (_, i) => mkTrack(i + 1)) as any
        return store
    }

    it('moves a track down (drop index is the target gap)', () => {
        const store = seed(4)
        store.moveTrack(0, 3)
        expect(hashes()).toEqual(['h2', 'h3', 'h1', 'h4'])
    })

    it('moves a track up', () => {
        const store = seed(4)
        store.moveTrack(3, 1)
        expect(hashes()).toEqual(['h1', 'h4', 'h2', 'h3'])
    })

    it('moves a track to the very end', () => {
        const store = seed(3)
        store.moveTrack(0, 3)
        expect(hashes()).toEqual(['h2', 'h3', 'h1'])
    })

    it('keeps every track — a move never changes the length', () => {
        const store = seed(6)
        store.moveTrack(4, 1)
        expect(store.allTracks).toHaveLength(6)
        expect(new Set(hashes()).size).toBe(6)
    })

    it('works on a partially loaded (paginated) playlist', () => {
        // info.count says 120 but only 38 are loaded — the state in which the old
        // full-list reorder submit destroyed the other 82 tracks.
        const store = seed(38)
        store.info = mkInfo(120) as any
        store.allLoaded = false

        store.moveTrack(0, 5)

        expect(store.allTracks).toHaveLength(38)
        expect(store.info.count).toBe(120)
        expect(hashes()[4]).toBe('h1')
    })
})
