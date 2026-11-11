import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import YearInMusicCard from '@/components/HomeView/YearInMusicCard.vue'
import useHome from '@/stores/home'
import { setSeasonPreview, type Season } from '@/utils/seasons'
import { DISMISSED_KEY } from '@/utils/yearInMusic'

const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

// As Home's answer carries it (`rewind`, #776): the years a Rewind opens for.
// `_season` only names the case; the card decides from the date (or the preview).
async function card(_season: Season | null, on: Date, years: number[] = [2025, 2026]) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(on)
    setActivePinia(createPinia())
    useHome().rewind = { years, seen: [], fresh: null }
    const w = mount(YearInMusicCard, { global: { stubs } })
    await flushPromises()
    return w
}

afterEach(() => {
    vi.useRealTimers()
    setSeasonPreview(null)
    localStorage.clear()
})

describe('YearInMusicCard on Home (#674)', () => {
    it('shows "Your year in music" on New Year\'s Eve, with a way into that year\'s Rewind', async () => {
        const w = await card('newyear', new Date(2026, 11, 31, 20))

        expect(w.find('.year-music-title').text()).toBe('Your year in music')
        expect(JSON.parse(w.find('.year-music-open').attributes('data-to')!)).toEqual({
            name: 'RewindView',
            params: { year: 2026 },
        })
    })

    it('shows nothing outside New Year\'s Eve', async () => {
        const w = await card('christmas', new Date(2026, 11, 20))
        expect(w.find('.year-music-card').exists()).toBe(false)
    })

    it('hides when this year has no Rewind to show', async () => {
        const w = await card('newyear', new Date(2026, 11, 31), [2025])
        expect(w.find('.year-music-card').exists()).toBe(false)
    })

    it('goes away for the year once dismissed, and stays away on reload', async () => {
        const w = await card('newyear', new Date(2026, 11, 31, 20))
        await w.find('.year-music-dismiss').trigger('click')
        expect(w.find('.year-music-card').exists()).toBe(false)
        expect(localStorage.getItem(DISMISSED_KEY)).toBe('2026')

        const again = await card('newyear', new Date(2026, 11, 31, 21))
        expect(again.find('.year-music-card').exists()).toBe(false)
    })

    it('shows on a preview on any day, for the current year', async () => {
        setSeasonPreview('newyear')
        const w = await card('newyear', new Date(2026, 5, 15))
        expect(w.find('.year-music-title').text()).toBe('Your year in music')
    })
})
