import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getListeningCalendar: vi.fn() }))
vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))

import ListeningCalendar from '@/components/Stats/ListeningCalendar.vue'
import { getListeningCalendar } from '@/requests/stats'

// As GET /logger/calendar sends it (#525).
const payload = {
    start: '2025-10-20',
    end: '2026-10-22',
    days: { '2026-10-21': 1800, '2026-10-22': 12000 },
    streaks: {
        current: { days: 2, start: '2026-10-21', end: '2026-10-22' },
        longest: { days: 9, start: '2025-12-28', end: '2026-01-05' },
    },
}

describe('ListeningCalendar', () => {
    it('draws a square for every day of the year and names both streaks', async () => {
        vi.mocked(getListeningCalendar).mockResolvedValue({ status: 200, data: payload } as any)

        const w = mount(ListeningCalendar)
        await flushPromises()

        const squares = w.findAll('.calendar-days .calendar-day')
        expect(squares).toHaveLength(53 * 7)
        expect(squares.filter(s => s.classes('is-future'))).toHaveLength(3)
        expect(squares.filter(s => s.classes('level-4'))).toHaveLength(1)

        const streaks = w.findAll('.streak').map(s => s.text())
        expect(streaks[0]).toContain('2 days')
        expect(streaks[1]).toContain('9 days')
        expect(streaks[1]).toContain('Dec 28, 2025 – Jan 5, 2026')

        expect(w.find('.calendar-grid').attributes('aria-label')).toBe(
            'Listening calendar: music on 2 days of the last 12 months. Current streak 2 days, longest 9 days.'
        )
    })

    it('shows nothing when the calendar cannot be loaded', async () => {
        vi.mocked(getListeningCalendar).mockResolvedValue({ status: 500, data: {} } as any)

        const w = mount(ListeningCalendar)
        await flushPromises()

        expect(w.find('.listening-calendar').exists()).toBe(false)
    })

    // The hidden door (#572): once a Rewind no longer announces itself, the
    // square of January 1 is the way back to the year that ended before it.
    describe('the door to Rewind', () => {
        const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

        async function calendar(rewindYears: number[]) {
            vi.mocked(getListeningCalendar).mockResolvedValue({ status: 200, data: payload } as any)
            const w = mount(ListeningCalendar, { props: { rewindYears }, global: { stubs } })
            await flushPromises()
            return w
        }

        it('is the square of January 1, looking like every other day', async () => {
            const w = await calendar([2024, 2025])

            const doors = w.findAll('.calendar-days a.calendar-day')
            expect(doors).toHaveLength(1)
            expect(doors[0].classes()).toContain('level-0')
            expect(doors[0].attributes('title')).toContain('Rewind 2025')
            expect(JSON.parse(doors[0].attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
            // Still a square of the grid: the count of days does not change.
            expect(w.findAll('.calendar-days .calendar-day')).toHaveLength(53 * 7)
        })

        it('has a way for the keyboard that only shows when focused', async () => {
            const w = await calendar([2025])

            expect(w.find('.calendar-days a').attributes('tabindex')).toBe('-1')
            expect(w.find('a.rewind-door').text()).toBe('Rewind 2025')
        })

        it('takes the newer year for the keyboard when 53 weeks hold two January 1sts', async () => {
            vi.mocked(getListeningCalendar).mockResolvedValue({
                status: 200,
                data: { ...payload, start: '2024-12-30', end: '2026-01-01', days: {} },
            } as any)
            const w = mount(ListeningCalendar, { props: { rewindYears: [2024, 2025] }, global: { stubs } })
            await flushPromises()

            expect(w.findAll('.calendar-days a')).toHaveLength(2)
            expect(w.find('a.rewind-door').text()).toBe('Rewind 2025')
        })

        it('is no door without a Rewind for the year before', async () => {
            const w = await calendar([2024])

            expect(w.findAll('.calendar-days a')).toHaveLength(0)
            expect(w.find('a.rewind-door').exists()).toBe(false)
        })
    })
})
