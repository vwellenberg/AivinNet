import { describe, expect, it } from 'vitest'

import {
    CalendarPayload,
    activeDays,
    calendarWeeks,
    dayTitle,
    level,
    listened,
    monthLabels,
    streakDays,
    streakRange,
} from '../listeningCalendar'

// As GET /logger/calendar sends it: 53 weeks, Monday 2025-10-20 to Thursday 2026-10-22.
const payload: CalendarPayload = {
    start: '2025-10-20',
    end: '2026-10-22',
    days: { '2025-10-20': 600, '2026-03-01': 7200, '2026-10-21': 1800, '2026-10-22': 12000 },
    streaks: {
        current: { days: 2, start: '2026-10-21', end: '2026-10-22' },
        longest: { days: 9, start: '2025-12-28', end: '2026-01-05' },
    },
}

describe('level', () => {
    it('shades by minutes listened', () => {
        expect([0, 60, 29 * 60, 30 * 60, 90 * 60, 3 * 3600].map(level)).toEqual([0, 1, 1, 2, 3, 4])
    })
})

describe('calendarWeeks', () => {
    const weeks = calendarWeeks(payload)

    it('is 53 columns of seven, Monday first', () => {
        expect(weeks).toHaveLength(53)
        expect(weeks.every(week => week.length === 7)).toBe(true)
        expect(weeks[0][0]?.date).toBe('2025-10-20')
    })

    it('ends today, with the rest of the week empty', () => {
        const last = weeks[52]
        expect(last.map(day => day?.date ?? null)).toEqual([
            '2026-10-19',
            '2026-10-20',
            '2026-10-21',
            '2026-10-22',
            null,
            null,
            null,
        ])
    })

    it('puts each day in its square, whatever the browser zone', () => {
        // Day-stepping in local time would slip an hour at DST and land a
        // square on the wrong date; the server's dates are walked in UTC.
        const all = weeks.flat().filter(Boolean)
        expect(all).toHaveLength(53 * 7 - 3)
        expect(all.find(day => day!.date === '2026-03-01')).toMatchObject({ seconds: 7200, level: 3 })
        expect(all.find(day => day!.date === '2026-03-02')).toMatchObject({ seconds: 0, level: 0 })
    })

    it('labels each month over the week of its first day', () => {
        const labels = monthLabels(weeks)
        expect(labels.map(l => l.label)).toEqual([
            'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct',
        ])
        // 2025-11-01 is a Saturday in the second column.
        expect(labels[0]).toEqual({ week: 1, label: 'Nov' })
    })
})

describe('words', () => {
    it('says how long', () => {
        expect(listened(45 * 60)).toBe('45 min')
        expect(listened(72 * 60)).toBe('1 h 12 min')
        expect(listened(3 * 3600)).toBe('3 h')
        expect(listened(20)).toBe('1 min')
    })

    it('titles a square', () => {
        expect(dayTitle({ date: '2026-10-03', seconds: 4320, level: 2 })).toBe('Oct 3, 2026 · 1 h 12 min')
        expect(dayTitle({ date: '2026-10-04', seconds: 0, level: 0 })).toBe('Oct 4, 2026 · no music')
    })

    it('names a streak', () => {
        expect(streakDays({ days: 1, start: '2026-10-22', end: '2026-10-22' })).toBe('1 day')
        expect(streakDays(payload.streaks.longest)).toBe('9 days')
        expect(streakRange(payload.streaks.current)).toBe('Oct 21 – Oct 22, 2026')
        // Across the new year both ends carry their year.
        expect(streakRange(payload.streaks.longest)).toBe('Dec 28, 2025 – Jan 5, 2026')
        expect(streakRange({ days: 1, start: '2026-10-22', end: '2026-10-22' })).toBe('Oct 22, 2026')
        expect(streakRange({ days: 0, start: null, end: null })).toBe('')
    })

    it('counts the days with music in the last 365 days', () => {
        // 2025-10-20 is in the window (it opens on a Monday) but 367 days back.
        expect(activeDays(payload)).toBe(3)
        expect(activeDays({ ...payload, days: { ...payload.days, '2025-10-23': 600 } })).toBe(4)
    })
})
