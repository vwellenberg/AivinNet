/**
 * The persisted stores must keep their localStorage keys and stored shape
 * across the pinia-plugin-persistedstate 3 -> 4 migration: a user who upgrades
 * keeps the sort order and the paged list state they had.
 *
 * The expected strings below are what v3 writes. Migrating `paths` to `pick`
 * and `afterRestore` to `afterHydrate` must not change them.
 */

import { createPinia, setActivePinia } from 'pinia'
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate'
import { createApp, nextTick } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))
vi.mock('@/requests/folders', () => ({ getFiles: vi.fn() }))
vi.mock('@/requests/getall', () => ({ getAllItems: vi.fn() }))

// Pinia 2 holds plugins passed to `use()` until the pinia is installed on an
// app, and never applies them to stores in a bare pinia. The app installs it
// in main.ts, so the test has to install it too.
function freshPinia() {
    const pinia = createPinia()
    createApp({}).use(pinia)
    pinia.use(piniaPluginPersistedstate)
    setActivePinia(pinia)
    return pinia
}

describe('folder store: sort fields persist under their v3 key and shape', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('writes exactly the four sort fields, in the v3 order, under the store id', async () => {
        freshPinia()
        const { default: useFolder } = await import('@/stores/pages/folder')
        const store = useFolder()

        store.trackSortBy = 'title'
        await nextTick()

        expect(localStorage.getItem('FolderDirs&Tracks')).toBe(
            '{"trackSortBy":"title","trackSortReverse":false,"folderSortBy":"name","folderSortReverse":false}'
        )
    })

    it('restores the four fields from a v3-written blob', async () => {
        localStorage.setItem(
            'FolderDirs&Tracks',
            JSON.stringify({ trackSortBy: 'year', trackSortReverse: true, folderSortBy: 'date', folderSortReverse: true })
        )
        freshPinia()
        const { default: useFolder } = await import('@/stores/pages/folder')
        const store = useFolder()

        expect(store.trackSortBy).toBe('year')
        expect(store.trackSortReverse).toBe(true)
        expect(store.folderSortBy).toBe('date')
        expect(store.folderSortReverse).toBe(true)
    })

    it('does not write unlisted state', async () => {
        freshPinia()
        const { default: useFolder } = await import('@/stores/pages/folder')
        const store = useFolder()

        store.query = 'something typed'
        store.trackSortBy = 'title'
        await nextTick()

        const stored = JSON.parse(localStorage.getItem('FolderDirs&Tracks') ?? '{}')
        expect(Object.keys(stored).sort()).toEqual(
            ['folderSortBy', 'folderSortReverse', 'trackSortBy', 'trackSortReverse']
        )
    })
})

describe('paged list store: afterRestore still runs after hydration', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('resets the paged list state after restoring a stored blob', async () => {
        localStorage.setItem(
            'albumlistpage',
            JSON.stringify({ items: [{ title: 'stale' }], total: 40, latestIndex: 2, canFetch: false })
        )
        freshPinia()
        const { useAlbumList } = await import('@/stores/pages/itemlist')
        const store = useAlbumList()

        expect(store.$state.items).toEqual([])
        expect(store.$state.total).toBe(0)
        // The hook writes this key onto $state although the state has no such field.
        expect((store.$state as unknown as Record<string, unknown>).latestIndex).toBe(0)
        expect(store.$state.canFetch).toBe(true)
    })
})
