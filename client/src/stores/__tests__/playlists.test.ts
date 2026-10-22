import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// --- mocks for the request layers the involved stores import ----------------
const reorderSidebarPlaylists = vi.fn()
const getAllPlaylists = vi.fn()

vi.mock('@/requests/playlists', () => ({
    getAllPlaylists: (...args: any[]) => getAllPlaylists(...args),
    reorderSidebarPlaylists: (...args: any[]) => reorderSidebarPlaylists(...args),
}))
vi.mock('@/requests/playlistFolders', () => ({
    createPlaylistFolder: vi.fn(),
    deletePlaylistFolder: vi.fn(),
    getPlaylistFolders: vi.fn(),
    movePlaylistToFolder: vi.fn(),
    renamePlaylistFolder: vi.fn(),
    reorderPlaylistFolders: vi.fn(),
}))
vi.mock('@/requests/album', () => ({
    getPinnedAlbums: vi.fn(),
    reorderPinnedAlbums: vi.fn(),
}))

import usePinnedAlbums from '@/stores/pages/pinnedAlbums'
import usePlaylists from '@/stores/pages/playlists'
import usePlaylistFolders from '@/stores/playlistFolders'

const MAX = Number.MAX_SAFE_INTEGER

const mkPl = (id: number, over: Partial<any> = {}) =>
    ({
        id,
        name: `Playlist ${id}`,
        pinned: false,
        settings: {},
        ...over,
    } as any)

describe('playlists.movePlayedToTop', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        reorderSidebarPlaylists.mockReset()
    })

    it('moves an un-pinned playlist above the other un-pinned ones with a single write', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1), mkPl(2), mkPl(3, { pinned: true, settings: { position: 0 } })]

        await store.movePlayedToTop(2)

        // min of the un-pinned group is MAX (no explicit positions yet)
        expect(reorderSidebarPlaylists).toHaveBeenCalledTimes(1)
        expect(reorderSidebarPlaylists).toHaveBeenCalledWith([{ id: 2, position: MAX - 1 }])
        // optimistic local update
        expect(store.playlists.find(p => p.id === 2)?.settings.position).toBe(MAX - 1)
        // the pinned group is untouched
        expect(store.playlists.find(p => p.id === 3)?.settings.position).toBe(0)
    })

    it('moves a pinned playlist above folders and pinned albums in the top zone', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1, { pinned: true, settings: { position: 2 } }), mkPl(2)]
        usePlaylistFolders().folders = [{ id: 9, name: 'F', position: 0, items: [] } as any]
        usePinnedAlbums().albums = [{ albumhash: 'ah', title: 'A', position: 1 } as any]

        await store.movePlayedToTop(1)

        expect(reorderSidebarPlaylists).toHaveBeenCalledWith([{ id: 1, position: -1 }])
    })

    it('does not write when the playlist is already strictly first in its group', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1, { settings: { position: 5 } }), mkPl(2)]

        await store.movePlayedToTop(1)

        expect(reorderSidebarPlaylists).not.toHaveBeenCalled()
    })

    it('leaves playlists inside a folder untouched', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1), mkPl(2)]
        usePlaylistFolders().folders = [{ id: 9, name: 'F', position: 0, items: [1] } as any]

        await store.movePlayedToTop(1)

        expect(reorderSidebarPlaylists).not.toHaveBeenCalled()
    })

    it('no-ops when the playlist is alone in its group or unknown', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1)]

        await store.movePlayedToTop(1)
        await store.movePlayedToTop(999)

        expect(reorderSidebarPlaylists).not.toHaveBeenCalled()
    })

    it('re-bubbling after another playlist was played keeps descending positions', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1, { settings: { position: MAX - 1 } }), mkPl(2)]

        // playlist 2 played after playlist 1 -> goes above it
        await store.movePlayedToTop(2)

        expect(reorderSidebarPlaylists).toHaveBeenCalledWith([{ id: 2, position: MAX - 2 }])
    })
})

// "Save folder as playlist" listed the new playlist twice in the sidebar:
// NewPlaylist.vue calls addPlaylist (an unshift 250 ms later) and then
// fetchAll. On a LAN the refetch answers first and already holds the new
// playlist, so the late unshift added it a second time.
describe('playlists.addPlaylist', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.useFakeTimers()
        getAllPlaylists.mockReset()
    })
    afterEach(() => {
        vi.useRealTimers()
    })

    it('does not list a playlist twice when the refetch answered before the delayed add', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1)]
        const created = mkPl(7, { name: 'World of Warcraft' })
        getAllPlaylists.mockResolvedValue([mkPl(1), mkPl(7, { name: 'World of Warcraft' })])

        store.addPlaylist(created)
        await store.fetchAll()
        vi.advanceTimersByTime(250)

        expect(store.playlists.map(p => p.id)).toEqual([1, 7])
    })

    it('still adds the playlist when the refetch has not answered yet', () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1)]

        store.addPlaylist(mkPl(7))
        vi.advanceTimersByTime(250)

        expect(store.playlists.map(p => p.id)).toEqual([7, 1])
    })
})

// A refetch that fails (network blip, the server restarting for a deploy)
// emptied the sidebar until the next reload, though nothing was deleted.
describe('playlists.fetchAll', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getAllPlaylists.mockReset()
    })

    it('keeps the list it has when the fetch fails', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1), mkPl(7)]
        getAllPlaylists.mockResolvedValue(null)

        expect(await store.fetchAll()).toBe(false)

        expect(store.playlists.map(p => p.id)).toEqual([1, 7])
        expect(store.sortedPlaylists).toHaveLength(2)
    })

    it('takes an empty list from the server as it is', async () => {
        const store = usePlaylists()
        store.playlists = [mkPl(1)]
        getAllPlaylists.mockResolvedValue([])

        expect(await store.fetchAll()).toBe(true)

        expect(store.playlists).toEqual([])
    })
})
