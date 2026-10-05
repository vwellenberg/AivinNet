import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const fetchHome = vi.fn()

vi.mock('../content-width', async () => {
    const { ref } = await import('vue')

    return { maxAbumCards: ref(6), fetchCardCount: ref(6) }
})
vi.mock('@/requests/home', () => ({ getHomePageData: (n: number) => fetchHome(n) }))

import useHome from '../home'

// The response shape of GET /nothome/ since the Home redesign (2026-10-05):
// rows in DISPLAY order, "continue_listening" first with a single item.
const album = { albumhash: 'a1', title: 'KCD II Soundtrack', image: 'a1.webp?pathhash=p1' }
const continueRow = {
    title: 'Continue listening',
    description: '',
    // As the server sends it: progress fields live on `item`.
    items: [{ type: 'album', item: { ...album, track_index: 22, track_total: 37, time: '2 hours ago' } as any }],
}
const response = [
    { continue_listening: continueRow },
    { recently_played: { title: 'Recently played', description: '', items: [{ type: 'album', item: album }] } },
    { rediscover: { title: 'Rediscover', description: 'x', items: [{ type: 'album', item: album }] } },
    { on_this_day: { title: 'On this day', description: '4 October 2025', items: [] } },
    { recently_added: { title: 'Recently added', description: 'y', items: [{ type: 'album', item: album }] } },
]

describe('home rows', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        fetchHome.mockReset()
        fetchHome.mockResolvedValue(response)
    })

    it('takes "continue listening" out of the rows and offers it as the card', async () => {
        const home = useHome()
        await home.fetchAll()

        expect(home.continueListening).toHaveLength(1)
        expect(home.continueListening[0]).toMatchObject({
            type: 'album',
            item: { albumhash: 'a1', track_index: 22, track_total: 37 },
        })
        expect(home.homepageItems.map(i => i.key)).not.toContain('continue_listening')
    })

    it('keeps the server order and drops empty rows', async () => {
        const home = useHome()
        await home.fetchAll()

        expect(home.homepageItems.map(i => i.key)).toEqual(['recently_played', 'rediscover', 'recently_added'])
    })

    it('passes several continues through, newest first', async () => {
        const second = { type: 'playlist', item: { id: 7, name: 'Arbeit', track_index: 2, track_total: 10 } }
        fetchHome.mockResolvedValue([
            { continue_listening: { ...continueRow, items: [...continueRow.items, second] } },
            ...response.slice(1),
        ])
        const home = useHome()
        await home.fetchAll()

        expect(home.continueListening.map(e => e.type)).toEqual(['album', 'playlist'])
    })

    it('has no card when the server sends nothing to continue', async () => {
        fetchHome.mockResolvedValue(response.slice(1))
        const home = useHome()
        await home.fetchAll()

        expect(home.continueListening).toEqual([])
    })
})
