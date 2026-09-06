/**
 * Time-of-day theme selection, pinned to Berlin local time.
 *
 * Berlin rather than the device's own zone on purpose: the app is used from
 * different machines (and from outside via Tailscale) but "day" and "night"
 * should mean the same thing on all of them. `Intl` handles CET/CEST, so the
 * switch follows DST without a hardcoded offset.
 */

/** Light from this hour (inclusive). */
export const LIGHT_FROM_HOUR = 8
/** Dark from this hour (inclusive) — so light is [08:00, 20:00). */
export const DARK_FROM_HOUR = 20

export const BERLIN_TIME_ZONE = 'Europe/Berlin'

/**
 * The hour (0-23) it currently is in Berlin.
 *
 * Read through `formatToParts` and normalised with `% 24`: with `hour12: false`
 * some engines render midnight as "24", which would slip past a naive
 * `hour < 8` comparison.
 */
export function berlinHour(now: Date = new Date(), timeZone: string = BERLIN_TIME_ZONE): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: 'numeric',
        hour12: false,
    }).formatToParts(now)

    const hour = Number(parts.find(p => p.type === 'hour')?.value)

    return Number.isFinite(hour) ? hour % 24 : 0
}

/**
 * Which theme the given Berlin hour calls for: light during the day
 * (08:00–19:59), dark otherwise.
 */
export function themeForHour(hour: number): 'light' | 'dark' {
    return hour >= LIGHT_FROM_HOUR && hour < DARK_FROM_HOUR ? 'light' : 'dark'
}

/** The theme the current Berlin time calls for. */
export function themeForNow(now: Date = new Date(), timeZone: string = BERLIN_TIME_ZONE): 'light' | 'dark' {
    return themeForHour(berlinHour(now, timeZone))
}
