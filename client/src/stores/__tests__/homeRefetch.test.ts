import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Ref } from 'vue'

const fetchHome = vi.fn()

// vi.mock is hoisted above top-level variables, so the refs are made inside.
vi.mock('../content-width', async () => {
    const { ref } = await import('vue')

    return { maxAbumCards: ref(6), fetchCardCount: ref(6) }
})
vi.mock('@/requests/home', () => ({ getHomePageData: (n: number) => fetchHome(n) }))

import * as widths from '../content-width'
import useHome from '../home'

const limit = widths.maxAbumCards as Ref<number>
const fetchFor = widths.fetchCardCount as Ref<number>

describe('home store refetch on widen', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        limit.value = 6
        fetchFor.value = 6
        fetchHome.mockReset()
        fetchHome.mockResolvedValue([])
    })

    it('asks for more cards once the window outgrew the first fetch', async () => {
        const home = useHome()
        await home.fetchAll()
        limit.value = 11
        fetchFor.value = 11
        await home.refetchIfWider()

        expect(fetchHome.mock.calls.map(c => c[0])).toEqual([6, 11])
    })

    it('does not refetch when the window shrank or stayed', async () => {
        const home = useHome()
        await home.fetchAll()
        limit.value = 4
        await home.refetchIfWider()
        limit.value = 6
        await home.refetchIfWider()

        expect(fetchHome).toHaveBeenCalledTimes(1)
    })

    it('does nothing before the first fetch', async () => {
        const home = useHome()
        limit.value = 12
        await home.refetchIfWider()

        expect(fetchHome).not.toHaveBeenCalled()
    })

    it('refreshes after a layout change, even one that hid every row', async () => {
        const home = useHome()
        await home.fetchAll() // every row hidden: nothing came back
        expect(Object.keys(home.homepageData)).toHaveLength(0)

        await home.refreshIfLoaded()

        expect(fetchHome).toHaveBeenCalledTimes(2)
    })

    it('leaves a Home that was never opened to fetch when it opens', async () => {
        const home = useHome()

        await home.refreshIfLoaded()

        expect(fetchHome).not.toHaveBeenCalled()
    })
})

// "Not interested" (#531): the card leaves the row at once, and comes back if
// the server refuses — unless Home was fetched in between.
describe('home store: dropCard', () => {
    const album = (albumhash: string) => ({ type: 'album', item: { albumhash } })
    const row = () => ({
        never_played: {
            items: [album('a'), album('b')],
            chips: [{ key: 'funk', label: 'funk rock', items: [album('a')] }],
        },
    })

    beforeEach(() => {
        setActivePinia(createPinia())
        fetchHome.mockReset()
    })

    it('takes the card out of the row and its chips, and can put it back', async () => {
        fetchHome.mockResolvedValue([row()])
        const home = useHome()
        await home.fetchAll()

        const putBack = home.dropCard('never_played', 'a')
        // @ts-ignore
        const shown = home.homepageData.never_played

        expect(shown.items.map((i: any) => i.item.albumhash)).toEqual(['b'])
        // Its only chip held just that album: gone.
        expect(shown.chips).toEqual([])

        putBack()
        expect(shown.items.map((i: any) => i.item.albumhash)).toEqual(['a', 'b'])
        expect(shown.chips).toHaveLength(1)
    })

    it('puts back only the card the server refused, not a second one marked meanwhile', async () => {
        fetchHome.mockResolvedValue([row()])
        const home = useHome()
        await home.fetchAll()

        const putBackA = home.dropCard('never_played', 'a')
        home.dropCard('never_played', 'b')
        putBackA() // the first mark failed, the second went through

        // @ts-ignore
        expect(home.homepageData.never_played.items.map((i: any) => i.item.albumhash)).toEqual(['a'])
    })

    it('does not put back over a fetch that came in between', async () => {
        fetchHome.mockResolvedValue([row()])
        const home = useHome()
        await home.fetchAll()

        const putBack = home.dropCard('never_played', 'a')
        fetchHome.mockResolvedValue([{ never_played: { items: [album('c')] } }])
        await home.fetchAll()
        putBack()

        // @ts-ignore
        expect(home.homepageData.never_played.items.map((i: any) => i.item.albumhash)).toEqual(['c'])
    })

    it('is a no-op for a row Home does not have', () => {
        const home = useHome()
        expect(() => home.dropCard('never_played', 'a')()).not.toThrow()
    })
})
