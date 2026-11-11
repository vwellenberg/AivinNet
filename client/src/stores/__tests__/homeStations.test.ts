import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Ref } from 'vue'

const getHomePageData = vi.fn()

vi.mock('../content-width', async () => {
    const { ref } = await import('vue')

    return { maxAbumCards: ref(6), fetchCardCount: ref(6) }
})
vi.mock('@/requests/home', () => ({ getHomePageData: (...args: unknown[]) => getHomePageData(...args) }))

import * as widths from '../content-width'
import useHome from '../home'

const station = (id: string) => ({ id, kind: 'genre', name: id })

/** A deferred answer, so a test decides which fetch lands first. */
function deferred<T>() {
    let resolve!: (value: T) => void
    const promise = new Promise<T>(r => (resolve = r))
    return { promise, resolve }
}

describe('home store: the dial comes with the rows (#776)', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        getHomePageData.mockReset()
        getHomePageData.mockResolvedValue({ rows: [], stations: [station('genre1')] })
    })

    it('stores the stations of the answer, next to the rows', async () => {
        const home = useHome()

        await home.fetchAll()

        expect(home.stations).toEqual([station('genre1')])
    })

    it('sends the season with the fetch, and nothing when there is none', async () => {
        const home = useHome()

        await home.fetchAll('christmas')
        expect(getHomePageData).toHaveBeenLastCalledWith(6, 'christmas')

        await home.fetchAll()
        expect(getHomePageData).toHaveBeenLastCalledWith(6, null)
    })

    it('keeps the season when the window widens and Home fetches again', async () => {
        const home = useHome()
        await home.fetchAll('newyear')

        // The window grew past what the last fetch asked for: a refetch follows.
        const window = widths.maxAbumCards as Ref<number>
        window.value = 9
        await home.refetchIfWider()
        window.value = 6

        expect(getHomePageData).toHaveBeenCalledTimes(2)
        expect(getHomePageData).toHaveBeenLastCalledWith(6, 'newyear')
    })

    it('a season change refetches only once Home has been loaded', async () => {
        const home = useHome()

        await home.refreshIfLoaded('christmas')
        expect(getHomePageData).not.toHaveBeenCalled()

        await home.fetchAll(null)
        await home.refreshIfLoaded('christmas')
        expect(getHomePageData).toHaveBeenLastCalledWith(6, 'christmas')
    })

    it('an answer to an older season does not overwrite the dial', async () => {
        const home = useHome()
        const christmas = deferred<{ rows: []; stations: unknown[] }>()
        getHomePageData.mockReturnValueOnce(christmas.promise)

        const first = home.fetchAll('christmas')
        await home.fetchAll(null)
        expect(home.stations).toEqual([station('genre1')])

        christmas.resolve({ rows: [], stations: [station('christmas'), station('genre1')] })
        await first

        expect(home.stations).toEqual([station('genre1')])
    })

    it('an older answer writes nothing, rows included: rows and dial come from one answer', async () => {
        const home = useHome()
        const older = deferred<{ rows: unknown[]; stations: unknown[] }>()
        getHomePageData.mockReturnValueOnce(older.promise)
        getHomePageData.mockResolvedValueOnce({
            rows: [{ recently_added: { title: 'New', items: [{ id: 'new' }] } }],
            stations: [station('genre1')],
        })

        const first = home.fetchAll('christmas')
        await home.fetchAll(null)
        older.resolve({
            rows: [{ recently_added: { title: 'Old', items: [{ id: 'old' }] } }],
            stations: [station('christmas')],
        })
        await first

        // @ts-ignore
        expect(home.homepageData.recently_added.title).toBe('New')
        expect(home.stations).toEqual([station('genre1')])
    })
})
