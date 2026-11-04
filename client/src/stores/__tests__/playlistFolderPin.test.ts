import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pinUnpinPlaylistFolder = vi.fn()

vi.mock('@/requests/playlistFolders', () => ({
    createPlaylistFolder: vi.fn(),
    deletePlaylistFolder: vi.fn(),
    getPlaylistFolders: vi.fn(),
    movePlaylistToFolder: vi.fn(),
    renamePlaylistFolder: vi.fn(),
    reorderPlaylistFolders: vi.fn(),
    pinUnpinPlaylistFolder: (...args: any[]) => pinUnpinPlaylistFolder(...args),
}))

import usePlaylistFolders from '@/stores/playlistFolders'

const folder = (over: Partial<any> = {}) => ({ id: 3, name: 'KCD', items: [7, 8], position: 2, pinned: true, ...over })

beforeEach(() => {
    setActivePinia(createPinia())
    pinUnpinPlaylistFolder.mockReset()
})

describe('playlistFolders.togglePin', () => {
    it('takes the pinned state the server answers', async () => {
        const store = usePlaylistFolders()
        store.folders = [folder()]
        pinUnpinPlaylistFolder.mockResolvedValue({ status: 200, data: { pinned: false } })

        await store.togglePin(3)

        expect(pinUnpinPlaylistFolder).toHaveBeenCalledWith(3)
        // Only the pin moves: playlists and position stay for re-pinning.
        expect(store.folders).toEqual([folder({ pinned: false })])
    })

    it('leaves the folder where it is when the server refuses', async () => {
        const store = usePlaylistFolders()
        store.folders = [folder()]
        pinUnpinPlaylistFolder.mockResolvedValue({ status: 404, data: { error: 'Folder not found' } })

        await store.togglePin(3)

        expect(store.folders[0].pinned).toBe(true)
    })
})
