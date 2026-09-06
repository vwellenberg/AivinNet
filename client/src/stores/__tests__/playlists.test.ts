import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// --- mocks for the request layers the involved stores import ----------------
const reorderSidebarPlaylists = vi.fn()

vi.mock('@/requests/playlists', () => ({
    getAllPlaylists: vi.fn(),
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
