import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))
const { getRewind } = vi.hoisted(() => ({ getRewind: vi.fn() }))
vi.mock('@/requests/stats', () => ({ getRewind }))

import RewindLink from '@/components/Stats/RewindLink.vue'

// RouterLink as a plain anchor that shows where it goes.
const stubs = {
    RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' },
    ArrowIcon: true,
}

const link = async (year: number | null | undefined) => {
    const w = mount(RewindLink, { props: { year }, global: { stubs } })
    await flushPromises()
    return w
}

// As GET /logger/rewind sends it (#527), the fields the door reads.
const YEAR_2025 = {
    year: 2025,
    plays: 11_384,
    seconds: 48_210 * 60,
    top_artists: [{ name: 'The Brothers Johnson', artisthash: 'ar1', image: 'ar1.webp', seconds: 3600 }],
}

beforeEach(() => {
    getRewind.mockReset().mockResolvedValue({ status: 200, data: YEAR_2025 })
})

// The stats page hands down the latest finished year: the way to Rewind stays
// at the foot of the page, seen or not (#572). The whole plate is the door.
describe('RewindLink', () => {
    it('names the latest finished year and goes there', async () => {
        const a = (await link(2025)).find('a')

        expect(a.attributes('aria-label')).toBe('Your 2025 Rewind')
        expect(a.text()).toContain('2025')
        expect(JSON.parse(a.attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('gives a taste of the year: minutes, plays, top artist', async () => {
        const w = await link(2025)

        expect(getRewind).toHaveBeenCalledWith(2025)
        const text = w.find('a').text()
        expect(text).toContain('48,210')
        expect(text).toContain('11,384')
        expect(text).toContain('The Brothers Johnson')
    })

    it('still opens without its numbers when the year cannot be loaded', async () => {
        getRewind.mockResolvedValue({ status: 500, data: null })

        const a = (await link(2025)).find('a')

        expect(a.exists()).toBe(true)
        expect(a.text()).toContain('Your year in music')
    })

    it('stands under a heading of its own, like the sections above it', async () => {
        expect((await link(2025)).find('.section-title').text()).toBe('Rewind')
    })

    it('is not there before a year with music has ended, or while the years are unknown', async () => {
        expect((await link(undefined)).find('a').exists()).toBe(false)
        expect((await link(null)).find('a').exists()).toBe(false)
        expect((await link(null)).find('.section-title').exists()).toBe(false)
        expect(getRewind).not.toHaveBeenCalled()
    })
})
