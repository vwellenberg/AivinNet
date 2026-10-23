import { flushPromises, shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getStats: vi.fn(), getDiscoveries: vi.fn() }))

import Stats from '@/components/Stats/Stats.vue'
import StatItem from '@/components/Stats/StatItem.vue'
import Discoveries from '@/components/Stats/Discoveries.vue'
import { getStats } from '@/requests/stats'

// The order /logger/stats really sends — top track first, library count last.
const ITEMS = [
    { cssclass: 'toptrack', text: 'Top track this week', value: '19. Rittersleut - Unknown', image: 'abc.webp' },
    { cssclass: 'streams', text: 'this week', value: '139 track plays' },
    { cssclass: 'playtime', text: 'this week', value: '5 hrs, 54 mins listened' },
    { cssclass: 'favorites', text: 'this week', value: '7 new favorites' },
    { cssclass: 'discoveries', text: 'new this week', value: '2 artists · 2 albums' },
    { cssclass: 'sources', text: 'this week', value: '62% albums · 25% playlists' },
    { cssclass: 'trackcount', text: 'in your library', value: '12,560 tracks' },
]

describe('Stats', () => {
    it('lays every tile out in ONE row — the last one is not pushed to the far edge', async () => {
        const w = shallowMount(Stats, { props: { items: ITEMS } })
        await nextTick()

        const tiles = w.findAllComponents(StatItem)
        expect(tiles.map(t => t.props('icon'))).toEqual(ITEMS.map(i => i.cssclass))

        // The bug: the last tile sat in its own `.right` column behind a `1fr`
        // one, so on a wide window it drifted away from the rest of the row.
        const row = w.find('.statshead').element
        for (const tile of tiles) {
            expect(tile.element.parentElement).toBe(row)
        }
    })
})

describe('Stats on the charts page (#523)', () => {
    const answer = (said: string) => ({
        status: 200,
        data: { stats: [{ cssclass: 'streams', text: said, value: '1 track play' }], dates: said },
    })

    it('asks for the period it is given, and again when it changes', async () => {
        const fetch = vi.mocked(getStats)
        fetch.mockReset()
        fetch.mockResolvedValueOnce(answer('this week') as any).mockResolvedValueOnce(answer('this year') as any)

        const w = shallowMount(Stats, { props: { period: 'week' } })
        await flushPromises()
        expect(fetch).toHaveBeenLastCalledWith('week')

        await w.setProps({ period: 'year' })
        await flushPromises()

        // The bug: the tiles were fetched once, for the week, whatever the tabs said.
        expect(fetch).toHaveBeenLastCalledWith('year')
        expect(w.findComponent(StatItem).props('text')).toBe('this year')
    })

    it('lets only the newest period paint', async () => {
        const fetch = vi.mocked(getStats)
        fetch.mockReset()
        let releaseWeek: (v: unknown) => void = () => {}
        fetch
            .mockReturnValueOnce(new Promise(resolve => (releaseWeek = resolve)) as any)
            .mockResolvedValueOnce(answer('this year') as any)

        const w = shallowMount(Stats, { props: { period: 'week' } })
        await w.setProps({ period: 'year' })
        await flushPromises()

        // The week answers last, after the user already picked the year.
        releaseWeek(answer('this week'))
        await flushPromises()

        expect(w.findComponent(StatItem).props('text')).toBe('this year')
    })

    it('clears the row when a period fails instead of keeping the last one', async () => {
        const fetch = vi.mocked(getStats)
        fetch.mockReset()
        fetch.mockResolvedValueOnce(answer('this week') as any).mockResolvedValueOnce({ status: 500, data: {} } as any)

        const w = shallowMount(Stats, { props: { period: 'week' } })
        await flushPromises()
        await w.setProps({ period: 'year' })
        await flushPromises()

        expect(w.findAllComponents(StatItem)).toHaveLength(0)
        expect(w.find('.statsdates').exists()).toBe(false)
    })

    it('does not fetch when the tiles are handed in (album and artist pages)', async () => {
        const fetch = vi.mocked(getStats)
        fetch.mockReset()

        shallowMount(Stats, { props: { items: ITEMS } })
        await flushPromises()

        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('the tile of what is new (#539)', () => {
    const answer = {
        status: 200,
        data: {
            stats: [
                { cssclass: 'streams', text: 'this week', value: '1 track play' },
                { cssclass: 'discoveries', text: 'new this week', value: '1 artist · 1 album' },
            ],
            dates: 'this week',
        },
    }

    it('opens the list of them on the stats page, and closes it again', async () => {
        vi.mocked(getStats).mockReset().mockResolvedValue(answer as any)
        const w = shallowMount(Stats, { props: { period: 'week' } })
        await flushPromises()

        const tile = w.findAllComponents(StatItem).find(t => t.props('icon') === 'discoveries')!
        expect(tile.props('expanded')).toBe(false)
        expect(w.findComponent(Discoveries).exists()).toBe(false)
        // The other tiles are no controls.
        expect(w.findAllComponents(StatItem).find(t => t.props('icon') === 'streams')!.props('expandable')).toBe(false)
        expect(tile.props('expandable')).toBe(true)

        tile.vm.$emit('toggle')
        await nextTick()
        expect(tile.props('expanded')).toBe(true)
        expect(w.findComponent(Discoveries).props('period')).toBe('week')
        expect(w.findComponent(Discoveries).attributes('id')).toBe(tile.props('controls'))

        tile.vm.$emit('toggle')
        await nextTick()
        expect(w.findComponent(Discoveries).exists()).toBe(false)
    })

    it('is no control where there is no period to list (an album or artist page)', async () => {
        const w = shallowMount(Stats, { props: { items: answer.data.stats } })
        await nextTick()

        expect(w.findAllComponents(StatItem).every(t => !t.props('expandable'))).toBe(true)
    })
})

