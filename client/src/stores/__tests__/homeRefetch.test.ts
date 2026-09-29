import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

const limit = ref(6)
const fetchFor = ref(6)
const fetchHome = vi.fn()

vi.mock('../content-width', () => ({ maxAbumCards: limit, fetchCardCount: fetchFor }))
vi.mock('@/requests/home', () => ({ getHomePageData: (n: number) => fetchHome(n) }))

import useHome from '../home'

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
