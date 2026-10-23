import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getRewindYears: vi.fn() }))
vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import RewindLink from '@/components/Stats/RewindLink.vue'
import { getRewindYears } from '@/requests/stats'

// RouterLink as a plain anchor that shows where it goes.
const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

async function link(years: number[], status = 200) {
    vi.mocked(getRewindYears).mockResolvedValue({ status, data: { years } } as any)
    const w = mount(RewindLink, { global: { stubs } })
    await flushPromises()
    return w
}

describe('RewindLink', () => {
    it('names the latest finished year and goes there', async () => {
        const a = (await link([2024, 2025])).find('a')

        expect(a.text()).toBe('Your 2025 Rewind')
        expect(JSON.parse(a.attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('is not there before a year with music has ended', async () => {
        // A first year of listening opens on January 1 (#527).
        expect((await link([])).find('a').exists()).toBe(false)
    })

    it('is not there when the years cannot be read', async () => {
        expect((await link([2025], 500)).find('a').exists()).toBe(false)
    })
})
