import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getListeningCalendar: vi.fn() }))

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
})
