import { describe, expect, it } from 'vitest'

import type { ClockPayload } from '@/requests/stats'
import { busiestHour, cellTitle, clockLayout, clockLevel, clockSummary, hourLabel } from '@/utils/listeningClock'

// As `GET /logger/clock` sends it (#535): Monday first, 24 hours a row.
function payload(cells: [number, number, number][]): ClockPayload {
    const days = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const [day, hour, seconds] of cells) days[day][hour] = seconds
    const total = cells.reduce((sum, [, , s]) => sum + s, 0)
    const top = [...cells].sort((a, b) => b[2] - a[2])[0]
    return {
        days,
        total,
        peak_hour: top ? { day: top[0], hour: top[1], seconds: top[2] } : null,
        peak_day: top ? { day: top[0], seconds: top[2] } : null,
        dates: 'Oct 20 - Oct 24',
    }
}

describe('listening clock (#535)', () => {
    it('shares the five shades out against the busiest hour', () => {
        expect(clockLevel(0, 3600)).toBe(0)
        expect(clockLevel(1, 3600)).toBe(1)
        expect(clockLevel(900, 3600)).toBe(1)
        expect(clockLevel(901, 3600)).toBe(2)
        expect(clockLevel(2700, 3600)).toBe(3)
        expect(clockLevel(3600, 3600)).toBe(4)
        // A period without music has no busiest hour.
        expect(clockLevel(0, 0)).toBe(0)
    })

    it('names hours on a 24-hour clock, the last one ending at midnight', () => {
        expect(hourLabel(0)).toBe('00:00')
        expect(hourLabel(20)).toBe('20:00')
        expect(cellTitle(4, 20, 4320)).toBe('Friday 20:00–21:00 · 1 h 12 min')
        expect(cellTitle(6, 23, 0)).toBe('Sunday 23:00–00:00 · no music')
    })

    it('says the busiest hour, and what the grid shows', () => {
        const clock = payload([
            [4, 20, 3000],
            [0, 8, 600],
        ])

        expect(busiestHour(clock)).toBe('Fri 20:00')
        expect(clockSummary(clock, 'for this week')).toBe(
            'Listening clock for this week: most music on Fridays, the busiest hour Friday from 20:00.'
        )
    })

    it('says nothing busy without music', () => {
        const clock = payload([])

        expect(busiestHour(clock)).toBe('')
        expect(clockSummary(clock, 'for today')).toBe('Listening clock for today: no music.')
    })

    it('lays the week out wide, or upright where 24 columns do not fit', () => {
        const { days } = payload([[4, 20, 3600]])

        const wide = clockLayout(days, false)
        // 24 columns of squares under four labels of six: the grid is as wide
        // as the squares, not the labels.
        expect(wide.width).toBe(24)
        expect(wide.columns.reduce((sum, c) => sum + c.span, 0)).toBe(wide.width)
        expect(wide.columns).toEqual(['00:00', '06:00', '12:00', '18:00'].map(label => ({ label, span: 6 })))
        expect(wide.rows.map(r => r.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
        expect(wide.rows[4].cells[20]).toEqual({ day: 4, hour: 20, seconds: 3600 })

        const upright = clockLayout(days, true)
        expect(upright.width).toBe(7)
        expect(upright.columns.map(c => c.label)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
        expect(upright.rows).toHaveLength(24)
        expect(upright.rows.map(r => r.label).filter(Boolean)).toEqual(
            ['00', '03', '06', '09', '12', '15', '18', '21'].map(h => `${h}:00`)
        )
        expect(upright.rows[20].cells[4]).toEqual({ day: 4, hour: 20, seconds: 3600 })
        // Every row is as long as there are columns: the grid places itself.
        expect(upright.rows.every(r => r.cells.length === 7)).toBe(true)
    })
})
