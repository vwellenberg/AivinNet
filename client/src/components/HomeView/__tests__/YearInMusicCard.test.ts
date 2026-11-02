import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

vi.mock('@/requests/stats', () => ({ getRewindYears: vi.fn() }))
vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import YearInMusicCard from '@/components/HomeView/YearInMusicCard.vue'
import { getRewindYears } from '@/requests/stats'
import { SEASON_KEY } from '@/utils/seasonLogo'
import { setSeasonPreview, type Season } from '@/utils/seasons'
import { DISMISSED_KEY } from '@/utils/yearInMusic'

const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

// As GET /stats/rewind/years answers it: the years a Rewind opens for.
async function card(season: Season | null, on: Date, years: number[] = [2025, 2026]) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(on)
    vi.mocked(getRewindYears).mockResolvedValue({ status: 200, data: { years, seen: [], fresh: null } } as any)
    const w = mount(YearInMusicCard, {
        global: { stubs, provide: { [SEASON_KEY as symbol]: ref(season) } },
    })
    await flushPromises()
    return w
}

afterEach(() => {
    vi.useRealTimers()
    vi.mocked(getRewindYears).mockReset()
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

    it('asks Rewind only while the New Year\'s season is on, and shows nothing otherwise', async () => {
        const w = await card('christmas', new Date(2026, 11, 20))
        expect(getRewindYears).not.toHaveBeenCalled()
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
