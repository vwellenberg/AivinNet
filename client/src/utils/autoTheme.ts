/**
 * Time-of-day theme selection for Auto dark mode.
 *
 * The clock it reads is a TIME ZONE, not the machine's raw offset: by default
 * the device's own zone (so "night" is night wherever the app is open), or a
 * zone pinned in the settings — useful when the app is reached from a machine
 * whose zone is set to something else (a server, a VM, a phone abroad) and
 * "day" should still mean home time. `Intl` handles DST, so the switch follows
 * summer/winter time without a hardcoded offset.
 */

/** Default: light from this hour (inclusive). */
export const LIGHT_FROM_HOUR = 8
/** Default: dark from this hour (inclusive) — so light is [08:00, 20:00). */
export const DARK_FROM_HOUR = 20

/** Stored value for "follow the device's own time zone". */
export const DEVICE_TIME_ZONE = 'device'

export interface AutoThemeSchedule {
    /** An IANA zone ('Europe/Berlin') or DEVICE_TIME_ZONE. */
    timeZone?: string
    lightFrom?: number
    darkFrom?: number
}

/** The zone the browser runs in, e.g. 'Europe/Berlin'. */
export function deviceTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
    } catch {
        return 'UTC'
    }
}

/** Whether `Intl` accepts the zone — a stored name can be stale or mistyped. */
export function isValidTimeZone(zone: string): boolean {
    try {
        new Intl.DateTimeFormat('en-GB', { timeZone: zone })
        return true
    } catch {
        return false
    }
}

/**
 * The IANA zone a stored setting stands for. DEVICE_TIME_ZONE, an empty value
 * and a zone this engine does not know all fall back to the device's zone —
 * an unknown zone would otherwise make `Intl` throw on every check.
 */
export function resolveTimeZone(zone: string | undefined): string {
    if (!zone || zone === DEVICE_TIME_ZONE || !isValidTimeZone(zone)) return deviceTimeZone()
    return zone
}

/**
 * A stored zone setting made safe to show and to use: DEVICE_TIME_ZONE or a
 * zone `Intl` accepts. Anything else (null, a typo, a zone another engine
 * knows) becomes DEVICE_TIME_ZONE — so the dropdown shows what the theme
 * actually follows, instead of a zone that is silently ignored.
 */
export function normalizeTimeZoneSetting(zone: unknown): string {
    if (typeof zone !== 'string' || zone === '' || zone === DEVICE_TIME_ZONE) return DEVICE_TIME_ZONE
    return isValidTimeZone(zone) ? zone : DEVICE_TIME_ZONE
}

/** Clamp a stored hour to 0-23; anything unusable becomes `fallback`. */
export function normalizeHour(hour: unknown, fallback: number): number {
    // Only numbers and numeric strings: `Number(null)`, `Number('')` and
    // `Number(false)` are all 0, and a NaN persisted to JSON comes back as null
    // — that would turn a lost hour into midnight instead of the default.
    if (typeof hour !== 'number' && (typeof hour !== 'string' || hour.trim() === '')) return fallback
    const n = Number(hour)
    if (!Number.isInteger(n)) return fallback
    return ((n % 24) + 24) % 24
}

/**
 * The hour (0-23) it currently is in the given zone.
 *
 * Read through `formatToParts` and normalised with `% 24`: with `hour12: false`
 * some engines render midnight as "24", which would slip past a naive
 * `hour < 8` comparison.
 */
export function hourIn(now: Date = new Date(), timeZone: string = deviceTimeZone()): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: 'numeric',
        hour12: false,
    }).formatToParts(now)

    const hour = Number(parts.find(p => p.type === 'hour')?.value)

    return Number.isFinite(hour) ? hour % 24 : 0
}

/**
 * Which theme the given hour calls for: light in [lightFrom, darkFrom), dark
 * otherwise. The window may wrap midnight (light 20 → dark 8 is a night-shift
 * schedule). Equal hours leave no light window at all: always dark.
 */
export function themeForHour(
    hour: number,
    lightFrom: number = LIGHT_FROM_HOUR,
    darkFrom: number = DARK_FROM_HOUR
): 'light' | 'dark' {
    if (lightFrom === darkFrom) return 'dark'

    const light = lightFrom < darkFrom ? hour >= lightFrom && hour < darkFrom : hour >= lightFrom || hour < darkFrom

    return light ? 'light' : 'dark'
}

/** The theme the current time in the schedule's zone calls for. */
export function themeForNow(now: Date = new Date(), schedule: AutoThemeSchedule = {}): 'light' | 'dark' {
    const hour = hourIn(now, resolveTimeZone(schedule.timeZone))

    return themeForHour(
        hour,
        normalizeHour(schedule.lightFrom ?? LIGHT_FROM_HOUR, LIGHT_FROM_HOUR),
        normalizeHour(schedule.darkFrom ?? DARK_FROM_HOUR, DARK_FROM_HOUR)
    )
}

/** '08:00' for 8. */
export function formatHour(hour: number): string {
    return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Every zone the engine knows, sorted. Older engines without
 * `Intl.supportedValuesOf` get a short list of common zones instead.
 */
export function availableTimeZones(): string[] {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    try {
        const zones = intl.supportedValuesOf?.('timeZone')
        if (zones?.length) return [...zones].sort()
    } catch {
        // fall through to the short list
    }

    return [
        'UTC',
        'Europe/Berlin',
        'Europe/London',
        'Europe/Lisbon',
        'Europe/Istanbul',
        'America/New_York',
        'America/Chicago',
        'America/Los_Angeles',
        'America/Sao_Paulo',
        'Asia/Dubai',
        'Asia/Kolkata',
        'Asia/Bangkok',
        'Asia/Tokyo',
        'Australia/Sydney',
    ].filter(isValidTimeZone)
}
