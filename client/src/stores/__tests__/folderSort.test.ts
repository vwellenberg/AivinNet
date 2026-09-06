/**
 * The folders half of the folder page's sort.
 *
 * `folderSortBy` and `folderSortReverse` sat in the store and were sent to the
 * server on every fetch — but nothing could change them, so every library
 * sorted its folders by name for ever while the backend had accepted
 * "default" | "name" | "lastmod" | "trackcount" the whole time.
 *
 * These tests pin the GESTURE rather than the plumbing: picking a new key
 * switches to it, picking the current key again flips the direction. That is
 * what the tracks sort next to it does, and the two controls sitting side by
 * side must not behave differently.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getFilesMock } = vi.hoisted(() => ({ getFilesMock: vi.fn() }))

// The store's fetchAll goes to the network. Stub the request layer rather than
// the action, so the action under test still runs its real body.
vi.mock('@/requests/folders', () => ({ getFiles: getFilesMock }))

vi.mock('@/router', () => ({
    router: { currentRoute: { value: { name: 'folder' } } },
    Routes: { folder: 'folder' },
}))

import useFolder from '@/stores/pages/folder'

describe('folder sort key', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getFilesMock.mockReset()
        getFilesMock.mockResolvedValue({ tracks: [], folders: [], path: '', total: 0 })
    })

    it('starts on the name key, which is what the server defaults to', () => {
        expect(useFolder().folderSortBy).toBe('name')
    })

    it('switches to a new key rather than toggling something else', () => {
        const folder = useFolder()

        folder.setFolderSortKey('trackcount')

        expect(folder.folderSortBy).toBe('trackcount')
    })

    it('flips the direction when the key it is already on is picked again', () => {
        const folder = useFolder()
        folder.setFolderSortKey('lastmod')
        const before = folder.folderSortReverse

        folder.setFolderSortKey('lastmod')

        expect(folder.folderSortBy).toBe('lastmod')
        expect(folder.folderSortReverse).toBe(!before)
    })

    it('leaves the tracks sort alone — the two controls are independent', () => {
        const folder = useFolder()
        const trackKey = folder.trackSortBy
        const trackReverse = folder.trackSortReverse

        folder.setFolderSortKey('trackcount')

        expect(folder.trackSortBy).toBe(trackKey)
        expect(folder.trackSortReverse).toBe(trackReverse)
    })

    it('and the tracks sort leaves the folders sort alone', () => {
        const folder = useFolder()
        folder.setFolderSortKey('lastmod')

        folder.setFolderTrackSortKey('title')

        expect(folder.folderSortBy).toBe('lastmod')
    })
})
