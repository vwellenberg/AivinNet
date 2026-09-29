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
})
