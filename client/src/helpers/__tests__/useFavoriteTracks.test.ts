import { describe, expect, it, vi, beforeEach } from 'vitest'

const getFavTracks = vi.fn()

vi.mock('@/requests/favorite', () => ({
    getFavTracks: (...args: any[]) => getFavTracks(...args),
}))

import { useFavoriteTracks } from '../useFavoriteTracks'

// Favorites as the server lists them: newest first, so the title says the position.
const mkTrack = (n: number, title = `Track ${n}`) => ({
    trackhash: `h${n}`,
    filepath: `/music/${n}.mp3`,
    title,
    album: 'Album',
    artists: [{ name: 'Artist' }],
    albumartists: [{ name: 'Artist' }],
    duration: 100,
})

const ALL = Array.from({ length: 120 }, (_, i) => mkTrack(i, i === 80 ? 'Needle Song' : `Track ${i}`))

// Mirrors the server: `start` and `limit` (-1 = everything after start).
function serve(start: number, limit: number) {
    const end = limit === -1 ? ALL.length : Math.min(ALL.length, start + limit)
    return Promise.resolve({ tracks: ALL.slice(start, end), total: ALL.length })
}

describe('useFavoriteTracks', () => {
    beforeEach(() => {
        getFavTracks.mockReset()
        getFavTracks.mockImplementation(serve)
    })

    it('finds a favorite beyond the first page after setQuery', async () => {
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()
        expect(list.tracks.value).toHaveLength(50)

        await list.setQuery('needle')

        expect(getFavTracks).toHaveBeenLastCalledWith(50, -1)
        expect(list.visible.value.map(t => t.title)).toEqual(['Needle Song'])
    })

    it('loads the rest once while several letters are typed', async () => {
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()

        // Keystrokes come before the first load has answered.
        const a = list.setQuery('n')
        const b = list.setQuery('ne')
        const c = list.setQuery('nee')
        await Promise.all([a, b, c])

        const fullLoads = getFavTracks.mock.calls.filter(([, limit]) => limit === -1)
        expect(fullLoads).toHaveLength(1)
        expect(list.tracks.value).toHaveLength(120)
    })

    it('does not reject or block the next keystroke when a load fails', async () => {
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()

        // useAxios resolves with no data on failure; a thrown request is covered too.
        getFavTracks.mockResolvedValueOnce(undefined)
        await expect(list.setQuery('needle')).resolves.toBeUndefined()
        expect(list.query.value).toBe('needle')
        expect(list.tracks.value).toHaveLength(50)

        getFavTracks.mockRejectedValueOnce(new Error('network'))
        await expect(list.setQuery('needles')).resolves.toBeUndefined()

        // The next keystroke tries again and succeeds.
        await list.setQuery('zqxvw')
        expect(list.tracks.value).toHaveLength(120)
        expect(list.visible.value).toHaveLength(0)
    })

    it('keeps index and master_index of filtered rows from the full list', async () => {
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()
        await list.setQuery('needle')

        const [hit] = list.visible.value
        expect(hit.title).toBe('Needle Song')
        // Position 80 in the full list: the play position, not 0 in the filtered one.
        expect(hit.master_index).toBe(80)
        expect(hit.index).toBe(list.trackCount.value - 80 - 1)
    })

    it('does not paginate while a query is set', async () => {
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()
        // Set the query without the rest loading (simulates a search still typed in).
        list.query.value = 'zzz'

        const before = getFavTracks.mock.calls.length
        await list.loadMore()
        expect(getFavTracks.mock.calls.length).toBe(before)
    })
})

describe('useFavoriteTracks paging', () => {
    beforeEach(() => {
        getFavTracks.mockReset()
        getFavTracks.mockImplementation(serve)
    })

    it('a sentinel firing again while a page is in flight asks for that page once', async () => {
        const list = useFavoriteTracks(() => 50)
        await Promise.all([list.loadMore(), list.loadMore(), list.loadMore()])
        expect(getFavTracks).toHaveBeenCalledTimes(1)
        expect(list.tracks.value).toHaveLength(50)
    })

    it('with no favorites at all, the list counts as loaded once the server has said so', async () => {
        getFavTracks.mockImplementation(() => Promise.resolve({ tracks: [], total: 0 }))
        const list = useFavoriteTracks(() => 50)
        await list.loadMore()
        await list.loadMore()
        await list.loadMore()
        expect(getFavTracks).toHaveBeenCalledTimes(1)
    })
})
