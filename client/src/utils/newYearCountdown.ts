/**
 * The New Year's countdown in the top bar (components/nav/NewYearCountdown.vue, #674).
 *
 * From 18:00 on 31 December it counts the time left to midnight, as hh:mm:ss. For
 * the first hour of 1 January it says "Happy New Year", and on any part of 1 January
 * the confetti is due once per device per year (newYearConfettiYear). Pure: the clock
 * is passed in, so the tests fix the dates. Only the storage guard touches the browser.
 *
 * The Appearance preview (utils/seasons.ts) shows the same countdown on any day,
 * counting to the next midnight.
 */

/** The countdown starts at this local hour on 31 December. */
export const COUNTDOWN_FROM_HOUR = 18

/** The "Happy New Year" line lasts this long after midnight on 1 January. */
export const CELEBRATION_MS = 60 * 60 * 1000

/** Where the once-per-year confetti is remembered: the year it fired for. */
export const CELEBRATED_KEY = 'aivinnet.newYearCelebrated'

export type Countdown =
    | { kind: 'none' }
    /** Counting down to the next local midnight. */
    | { kind: 'counting'; remainingMs: number }
    /** 1 January, the first hour: the greeting, no clock. */
    | { kind: 'celebrating' }

/** The next local midnight after `now`. */
function nextMidnight(now: Date): number {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
}

/**
 * What the top bar shows at `now`. `preview` counts to the next midnight on any
 * day, so the countdown can be seen without waiting for New Year's Eve.
 */
export function countdownAt(now: Date, preview = false): Countdown {
    if (preview) {
        return { kind: 'counting', remainingMs: nextMidnight(now) - now.getTime() }
    }
    const month = now.getMonth()
    const day = now.getDate()
    if (month === 11 && day === 31 && now.getHours() >= COUNTDOWN_FROM_HOUR) {
        return { kind: 'counting', remainingMs: nextMidnight(now) - now.getTime() }
    }
    if (month === 0 && day === 1) {
        const sinceMidnight = now.getTime() - new Date(now.getFullYear(), 0, 1).getTime()
        if (sinceMidnight < CELEBRATION_MS) return { kind: 'celebrating' }
    }
    return { kind: 'none' }
}

/**
 * The clock face for the time left: hh:mm:ss, rounded UP to the second, so the
 * display reads 00:00:01 at the last second before midnight and never 00:00:00
 * before it. Two digits a field; the hours run past 23 only in a preview.
 */
export function clockText(remainingMs: number): string {
    const total = Math.max(0, Math.ceil(remainingMs / 1000))
    const h = Math.floor(total / 3600)
    const m = Math.floor((total % 3600) / 60)
    const s = total % 60
    return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/**
 * The year whose confetti is due at `now`, or null. It is due on any part of 1 January
 * (local time), once per year: `firedFor` is the year it last fired for on this device.
 * A page open across midnight gets it on the first tick of 1 January, and a page opened
 * later that day gets it too, unless the year is already remembered.
 */
export function newYearConfettiYear(now: Date, firedFor: number | null): number | null {
    if (now.getMonth() !== 0 || now.getDate() !== 1) return null
    const year = now.getFullYear()
    return firedFor === year ? null : year
}

/** The year the confetti last fired for on this device, or null (also when storage is blocked). */
export function readCelebratedYear(): number | null {
    try {
        const raw = window.localStorage.getItem(CELEBRATED_KEY)
        if (raw === null) return null
        const year = Number(raw)
        return Number.isInteger(year) ? year : null
    } catch {
        // Private window or blocked site data: the confetti may come again, once per load.
        return null
    }
}

/** Remembers that the confetti fired for `year`. A blocked store just forgets it. */
export function rememberCelebratedYear(year: number): void {
    try {
        window.localStorage.setItem(CELEBRATED_KEY, String(year))
    } catch {
        // Nothing to remember it in: the component's own flag still stops a second burst.
    }
}
