import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The list behind the "new artists · new albums" tile (#539).
const { getDiscoveries } = vi.hoisted(() => ({ getDiscoveries: vi.fn() }))
vi.mock('@/requests/stats', () => ({ getDiscoveries }))

import Discoveries from '@/components/Stats/Discoveries.vue'
import CardRow from '@/components/shared/CardRow.vue'

// As GET /logger/discoveries sends them: cards beside their type, the first
// play as the help text, the image with its suffix.
const FOUND = {
    artists: [{ type: 'artist', item: { artisthash: 'b0000000000000pr', name: 'Primus', help_text: 'first played Oct 21' } }],
    albums: [
        {
            type: 'album',
            item: { albumhash: 'a0000000000000pr', title: 'Frizzle Fry', image: 'a0000000000000pr.webp?pathhash=ph', help_text: 'first played Oct 21' },
        },
    ],
    total: { artists: 1, albums: 3 },
}

const panel = async (period = 'week') => {
    const w = mount(Discoveries, { props: { period }, global: { stubs: { CardRow: true } } })
    await flushPromises()
    return w
}

beforeEach(() => {
    getDiscoveries.mockReset().mockResolvedValue({ status: 200, data: FOUND })
})

describe('Discoveries', () => {
    it('shows the new artists and albums with how many there are in all', async () => {
        const w = await panel()

        expect(getDiscoveries).toHaveBeenCalledWith('week')
        expect(w.findAll('h3').map(h => h.text())).toEqual(['New artists · 1', 'New albums · 3'])
        const rows = w.findAllComponents(CardRow)
        // CardRow picks the card by the item's own type.
        expect(rows[0].props('items')).toEqual([{ ...FOUND.artists[0].item, type: 'artist' }])
        expect(rows[1].props('items')).toEqual([{ ...FOUND.albums[0].item, type: 'album' }])
    })

    it('says so when nothing was new', async () => {
        getDiscoveries.mockResolvedValue({ status: 200, data: { artists: [], albums: [], total: { artists: 0, albums: 0 } } })

        const w = await panel('month')

        expect(w.text()).toContain('Nothing heard for the first time this month')
        expect(w.findAll('h3')).toHaveLength(0)
    })

    it('asks again for another period, and lets only the newest answer paint', async () => {
        let releaseWeek: (v: unknown) => void = () => {}
        getDiscoveries
            .mockReset()
            .mockReturnValueOnce(new Promise(resolve => (releaseWeek = resolve)))
            .mockResolvedValueOnce({ status: 200, data: { ...FOUND, total: { artists: 9, albums: 9 } } })

        const w = mount(Discoveries, { props: { period: 'week' }, global: { stubs: { CardRow: true } } })
        await w.setProps({ period: 'year' })
        await flushPromises()
        releaseWeek({ status: 200, data: FOUND })
        await flushPromises()

        expect(getDiscoveries).toHaveBeenLastCalledWith('year')
        expect(w.find('h3').text()).toBe('New artists · 9')
    })

    it('says so when the list cannot be loaded', async () => {
        getDiscoveries.mockResolvedValue({ status: 500, data: null })

        const w = await panel()

        expect(w.text()).toContain('could not be loaded')
    })

    it('is no longer busy when the request throws, and says the list is missing', async () => {
        getDiscoveries.mockRejectedValue(new Error('offline'))

        const w = await panel()

        expect(w.text()).toContain('could not be loaded')
        expect(w.find('section').attributes('aria-busy')).toBe('false')
    })
})
