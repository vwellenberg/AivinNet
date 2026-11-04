import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getPinnedFolders = vi.fn()
const toggleFolderPin = vi.fn()

vi.mock('@/requests/folders', () => ({
    getTracksInPath: vi.fn(),
    getPinnedFolders: (...args: any[]) => getPinnedFolders(...args),
    reorderPinnedFolders: vi.fn(),
}))
vi.mock('@/requests/playlists', () => ({ addFolderToPlaylist: vi.fn() }))
vi.mock('@/helpers/pinFolder', () => ({ toggleFolderPin: (...args: any[]) => toggleFolderPin(...args) }))
vi.mock('@/stores/modal', () => ({ default: () => ({}) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({}) }))
vi.mock('../utils', () => ({ getAddToPlaylistOptions: vi.fn() }))

import folderContextItems from '@/context_menus/folder'
import usePinnedFolders from '@/stores/pages/pinnedFolders'

const pinOf = async (path: string) => (await folderContextItems(path)).find(o => /pin/i.test(o.label ?? ''))!

beforeEach(() => {
    setActivePinia(createPinia())
    getPinnedFolders.mockReset()
    toggleFolderPin.mockReset()
})

describe('folder menu: pin to library', () => {
    it('offers "Pin" for a folder that is not pinned, and pins that path', async () => {
        getPinnedFolders.mockResolvedValue([])

        const pin = await pinOf('/music/Rock/')
        expect(pin.label).toBe('Pin to library')

        pin.action!()
        expect(toggleFolderPin).toHaveBeenCalledWith('/music/Rock/')
    })

    it('offers "Unpin" for a pinned folder in any spelling', async () => {
        getPinnedFolders.mockResolvedValue([
            { name: 'Rock', path: '/music/Rock/', trackcount: 1, is_sym: false, position: null },
        ])

        expect((await pinOf('/music/Rock')).label).toBe('Unpin from library')
    })

    // The phone has no sidebar, so nothing has loaded the pins there: without
    // the read the menu said "Pin" for a pinned folder and the toggle unpinned it.
    it('reads the pins first when nothing has loaded them yet — once', async () => {
        getPinnedFolders.mockResolvedValue([
            { name: 'Rock', path: '/music/Rock/', trackcount: 1, is_sym: false, position: null },
        ])
        expect(usePinnedFolders().loaded).toBe(false)

        expect((await pinOf('/music/Rock/')).label).toBe('Unpin from library')
        await pinOf('/music/Rock/')

        expect(getPinnedFolders).toHaveBeenCalledTimes(1)
    })
})
