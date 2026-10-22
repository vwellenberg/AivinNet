/**
 * The listening calendar on the stats page (#525): `GET /logger/calendar`
 * turned into columns of weeks, the shade of each day and the words around it.
 *
 * Dates are the SERVER's calendar days ("2026-10-22"), so they are read and
 * stepped in UTC here: a browser in another zone must not move a day.
 */

export interface StreakData {
    days: number
    start: string | null
    end: string | null
}

export interface CalendarPayload {
    start: string
    end: string
    /** Seconds listened per day; days without music are left out. */
    days: Record<string, number>
    streaks: { current: StreakData; longest: StreakData }
}

export interface CalendarDay {
    date: string
    seconds: number
    level: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Where the shades change, in seconds: under half an hour, under an hour and
 * a half, under three hours, more. Fixed minutes rather than quantiles of the
 * user's own year, so a square means the same in a quiet year as in a busy one.
 */
export const LEVEL_BOUNDS = [30 * 60, 90 * 60, 3 * 60 * 60] as const

export function level(seconds: number): number {
    if (seconds <= 0) return 0
    const below = LEVEL_BOUNDS.findIndex(bound => seconds < bound)
    return below === -1 ? LEVEL_BOUNDS.length + 1 : below + 1
}

function parse(day: string): number {
    const [y, m, d] = day.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
}

function iso(ms: number): string {
    return new Date(ms).toISOString().slice(0, 10)
}

/**
 * The calendar as columns of seven (Monday on top), oldest week first. Days
 * after `end` — the rest of this week — are `null`: there is nothing to show
 * for them yet.
 */
export function calendarWeeks(payload: CalendarPayload): (CalendarDay | null)[][] {
    const end = parse(payload.end)
    const weeks: (CalendarDay | null)[][] = []

    for (let monday = parse(payload.start); monday <= end; monday += 7 * DAY_MS) {
        const week: (CalendarDay | null)[] = []
        for (let i = 0; i < 7; i++) {
            const ms = monday + i * DAY_MS
            if (ms > end) {
                week.push(null)
                continue
            }
            const date = iso(ms)
            const seconds = payload.days[date] ?? 0
            week.push({ date, seconds, level: level(seconds) })
        }
        weeks.push(week)
    }

    return weeks
}

/** A month name over the first week that holds that month's first day. */
export function monthLabels(weeks: (CalendarDay | null)[][]): { week: number; label: string }[] {
    const labels: { week: number; label: string }[] = []

    weeks.forEach((week, index) => {
        const first = week.find(day => day !== null && day.date.endsWith('-01'))
        if (first) labels.push({ week: index, label: monthName(first.date) })
    })

    return labels
}

function monthName(day: string): string {
    return new Date(parse(day)).toLocaleString('en', { month: 'short', timeZone: 'UTC' })
}

export function shortDate(day: string, withYear = false): string {
    return new Date(parse(day)).toLocaleString('en', {
        month: 'short',
        day: 'numeric',
        ...(withYear ? { year: 'numeric' } : {}),
        timeZone: 'UTC',
    })
}

/** "45 min", "1 h 12 min", "3 h". */
export function listened(seconds: number): string {
    const minutes = Math.max(1, Math.round(seconds / 60))
    if (minutes < 60) return `${minutes} min`
    const hours = Math.floor(minutes / 60)
    const rest = minutes % 60
    return rest ? `${hours} h ${rest} min` : `${hours} h`
}

/** What a square says under the pointer: "Oct 3, 2026 · 1 h 12 min". */
export function dayTitle(day: CalendarDay): string {
    return `${shortDate(day.date, true)} · ${day.seconds ? listened(day.seconds) : 'no music'}`
}

export function streakDays(streak: StreakData): string {
    return `${streak.days} ${streak.days === 1 ? 'day' : 'days'}`
}

/** "Mar 3 – Apr 18, 2025"; one day is just its date; no streak, nothing. */
export function streakRange(streak: StreakData): string {
    if (!streak.days || !streak.start || !streak.end) return ''
    if (streak.start === streak.end) return shortDate(streak.end, true)

    const sameYear = streak.start.slice(0, 4) === streak.end.slice(0, 4)
    return `${shortDate(streak.start, !sameYear)} – ${shortDate(streak.end, true)}`
}

/**
 * Days with music in the last 365 days. Not the whole window: it reaches back
 * to a Monday, up to 371 days, and "in 12 months" could then count more days
 * than a year has.
 */
export function activeDays(payload: CalendarPayload): number {
    const since = parse(payload.end) - 364 * DAY_MS
    return Object.keys(payload.days).filter(day => parse(day) >= since).length
}
