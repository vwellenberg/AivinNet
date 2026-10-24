/**
 * The listening clock on the stats page (#535): `GET /logger/clock` turned
 * into shades and words. Seven rows of 24 hours, Monday first, in the
 * SERVER's time — the browser's zone does not move an hour.
 */

import type { ClockPayload } from '@/requests/stats'
import { listened } from '@/utils/listeningCalendar'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const

/**
 * The calendar's five shades, shared out against the busiest hour of the
 * period rather than fixed minutes: a cell sums every week of the period, so
 * "an hour" means one thing for a week and another for all time.
 */
export function clockLevel(seconds: number, busiest: number): number {
    if (seconds <= 0 || busiest <= 0) return 0
    return Math.min(4, Math.ceil((seconds / busiest) * 4))
}

export interface ClockCell {
    day: number
    hour: number
    seconds: number
}

export interface ClockLayout {
    /** How many columns of squares; the labels over them may span several. */
    width: number
    /** The labels over the columns; `span` columns each. */
    columns: { label: string; span: number }[]
    /** One label (may be empty) and the cells of each row. */
    rows: { label: string; cells: ClockCell[] }[]
}

/**
 * The grid as rows and columns. Wide, the week reads down and the day across
 * (a label every six hours). Upright, where 24 columns would leave squares of
 * 5 to 8 px on a phone, the hours read down and the days across.
 */
export function clockLayout(days: number[][], upright: boolean): ClockLayout {
    if (!upright) {
        return {
            width: 24,
            columns: [0, 6, 12, 18].map(hour => ({ label: hourLabel(hour), span: 6 })),
            rows: days.map((hours, day) => ({
                label: WEEKDAYS[day].slice(0, 3),
                cells: hours.map((seconds, hour) => ({ day, hour, seconds })),
            })),
        }
    }

    return {
        width: 7,
        columns: WEEKDAYS.map(day => ({ label: day.slice(0, 3), span: 1 })),
        rows: Array.from({ length: 24 }, (_, hour) => ({
            label: hour % 3 === 0 ? hourLabel(hour) : '',
            cells: days.map((hours, day) => ({ day, hour, seconds: hours[hour] })),
        })),
    }
}

/** "20:00" — a 24-hour clock, the same for every reader. */
export function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`
}

/** What a square says under the pointer: "Friday 20:00–21:00 · 1 h 12 min". */
export function cellTitle(day: number, hour: number, seconds: number): string {
    const span = `${hourLabel(hour)}–${hourLabel((hour + 1) % 24)}`
    return `${WEEKDAYS[day]} ${span} · ${seconds ? listened(seconds) : 'no music'}`
}

/** "Fri 20:00", the busiest hour; nothing without music. */
export function busiestHour(clock: ClockPayload): string {
    const peak = clock.peak_hour
    return peak ? `${WEEKDAYS[peak.day].slice(0, 3)} ${hourLabel(peak.hour)}` : ''
}

/** The grid is a picture to a screen reader; this is what it shows. `period`: "for this week". */
export function clockSummary(clock: ClockPayload, period: string): string {
    if (!clock.peak_hour || !clock.peak_day) return `Listening clock ${period}: no music.`
    return (
        `Listening clock ${period}: most music on ${WEEKDAYS[clock.peak_day.day]}s, ` +
        `the busiest hour ${WEEKDAYS[clock.peak_hour.day]} from ${hourLabel(clock.peak_hour.hour)}.`
    )
}
