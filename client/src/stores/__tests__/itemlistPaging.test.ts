import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => get(...args) }))
vi.mock('@/router', () => ({
    Routes: { AlbumList: 'AlbumListView' },
    router: { currentRoute: { value: { name: 'AlbumListView' } } },
}))

import { useAlbumList } from '../pages/itemlist'

// ---------------------------------------------------------------------------
// Since #142 the fetcher stays mounted at the end of the list instead of being
// rebuilt by a random key, so it can ask this store for another page far more
// often — including after the collection has run out. Both guards below exist
// because of that, and both fail silently:
//
//   - paging past the end answers with empty pages forever, so the traffic is
//     invisible in the UI;
//   - `useAxios` RESOLVES on failure ({ error, data: undefined }), so reading
//     `data.total` off it threw past the line that clears `canFetch` — one
//     dropped request and the list never loaded again, with no error state.
// ---------------------------------------------------------------------------

/** A page of the /getall/albums shape. */
const page = (count: number, total: number) => ({
    status: 200,
    data: { items: Array.from({ length: count }, (_, i) => ({ albumhash: `h${i}` })), total },
})

/** What the wrapper hands back when the request did not go through. */
const failure = { error: 'Network Error', data: undefined, status: undefined }

describe('the album list stops at the end of the collection', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        get.mockReset()
    })

    it('does not ask for pages past the total', async () => {
        const store = useAlbumList()
        get.mockResolvedValue(page(50, 60))

        await store.getAlbums(0)
        await store.getMoreAlbums()
        expect(get).toHaveBeenCalledTimes(2)

        // 100 items fetched against a total of 60: there is nothing left, and
        // the fetcher sitting at the bottom must not turn that into traffic.
        await store.getMoreAlbums()
        await store.getMoreAlbums()
        expect(get).toHaveBeenCalledTimes(2)
    })

    it('still loads the first page while the total is unknown', async () => {
        const store = useAlbumList()
        get.mockResolvedValue(page(50, 120))

        // `total` starts at 0, which must not read as "nothing left".
        await store.getAlbums(0)

        expect(get).toHaveBeenCalledTimes(1)
        expect(store.items).toHaveLength(50)
    })
})

describe('a failed page leaves the list usable', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        get.mockReset()
    })

    it('recovers instead of locking the store for good', async () => {
        const store = useAlbumList()
        get.mockResolvedValueOnce(failure)

        await store.getAlbums(0)

        expect(store.items).toHaveLength(0)
        // The flag is what the next attempt checks first. Left false, the list
        // was dead until a reload.
        expect(store.canFetch).toBe(true)

        get.mockResolvedValueOnce(page(50, 120))
        await store.getAlbums(0)
        expect(store.items).toHaveLength(50)
    })
})
