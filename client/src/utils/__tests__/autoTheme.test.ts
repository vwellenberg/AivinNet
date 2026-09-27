import { describe, expect, it } from 'vitest'

import {
    availableTimeZones,
    DARK_FROM_HOUR,
    DEVICE_TIME_ZONE,
    deviceTimeZone,
    formatHour,
    hourIn,
    LIGHT_FROM_HOUR,
    normalizeHour,
    normalizeTimeZoneSetting,
    resolveTimeZone,
    themeForHour,
    themeForNow,
} from '@/utils/autoTheme'

const BERLIN = 'Europe/Berlin'
const berlinHour = (now: Date) => hourIn(now, BERLIN)
const berlin = { timeZone: BERLIN }

describe('themeForHour', () => {
    it('is light for the whole day window', () => {
        for (let h = LIGHT_FROM_HOUR; h < DARK_FROM_HOUR; h++) {
            expect(themeForHour(h)).toBe('light')
        }
    })

    it('is dark for every hour outside it', () => {
        for (const h of [0, 1, 5, 7, 20, 21, 23]) {
            expect(themeForHour(h)).toBe('dark')
        }
    })

    it('switches to light exactly at 08:00', () => {
        expect(themeForHour(7)).toBe('dark')
        expect(themeForHour(8)).toBe('light')
    })

    it('switches to dark exactly at 20:00', () => {
        expect(themeForHour(19)).toBe('light')
        expect(themeForHour(20)).toBe('dark')
    })

    it('treats midnight as dark, whether it reads as 0 or 24', () => {
        expect(themeForHour(0)).toBe('dark')
        expect(themeForHour(24 % 24)).toBe('dark')
    })
})

describe('hourIn (Europe/Berlin)', () => {
    it('reads Berlin local time, not UTC (summer, CEST = UTC+2)', () => {
        // 2026-07-15 05:30 UTC -> 07:30 in Berlin
        expect(berlinHour(new Date('2026-07-15T05:30:00Z'))).toBe(7)
    })

    it('reads Berlin local time, not UTC (winter, CET = UTC+1)', () => {
        // 2026-01-15 05:30 UTC -> 06:30 in Berlin
        expect(berlinHour(new Date('2026-01-15T05:30:00Z'))).toBe(6)
    })

    it('follows daylight saving without a hardcoded offset', () => {
        // The same UTC wall time falls in different Berlin hours across DST.
        const summer = berlinHour(new Date('2026-07-15T18:30:00Z'))
        const winter = berlinHour(new Date('2026-01-15T18:30:00Z'))
        expect(summer).toBe(20)
        expect(winter).toBe(19)
    })

    it('normalises midnight to 0, never 24', () => {
        // 2026-07-14 22:00 UTC = 2026-07-15 00:00 CEST
        expect(berlinHour(new Date('2026-07-14T22:00:00Z'))).toBe(0)
    })

    it('is independent of the machine timezone (Tokyo clock, Berlin decision)', () => {
        const utcNoon = new Date('2026-07-15T12:00:00Z')
        expect(hourIn(utcNoon, 'Asia/Tokyo')).toBe(21)
        expect(berlinHour(utcNoon)).toBe(14)
    })
})

describe('themeForNow', () => {
    it('is dark late in the Berlin evening even when UTC still reads afternoon', () => {
        // 18:30 UTC in summer = 20:30 in Berlin -> already dark.
        expect(themeForNow(new Date('2026-07-15T18:30:00Z'), berlin)).toBe('dark')
    })

    it('is light during the Berlin day', () => {
        expect(themeForNow(new Date('2026-07-15T10:00:00Z'), berlin)).toBe('light')
    })

    it('is dark early in the Berlin morning', () => {
        // 04:00 UTC summer = 06:00 Berlin.
        expect(themeForNow(new Date('2026-07-15T04:00:00Z'), berlin)).toBe('dark')
    })
})

describe('themeForHour with a custom window', () => {
    it('honours other hours', () => {
        expect(themeForHour(6, 7, 18)).toBe('dark')
        expect(themeForHour(7, 7, 18)).toBe('light')
        expect(themeForHour(17, 7, 18)).toBe('light')
        expect(themeForHour(18, 7, 18)).toBe('dark')
    })

    it('wraps midnight when light starts after dark', () => {
        // Night shift: light 20:00 -> 08:00.
        expect(themeForHour(20, 20, 8)).toBe('light')
        expect(themeForHour(23, 20, 8)).toBe('light')
        expect(themeForHour(0, 20, 8)).toBe('light')
        expect(themeForHour(7, 20, 8)).toBe('light')
        expect(themeForHour(8, 20, 8)).toBe('dark')
        expect(themeForHour(19, 20, 8)).toBe('dark')
    })

    it('is always dark when both hours are equal', () => {
        for (let h = 0; h < 24; h++) expect(themeForHour(h, 9, 9)).toBe('dark')
    })
})

describe('themeForNow: the time zone decides', () => {
    const utc = new Date('2026-07-15T12:00:00Z') // 14:00 Berlin, 21:00 Tokyo, 08:00 New York

    it('reads the same instant differently per zone', () => {
        expect(themeForNow(utc, { timeZone: 'Europe/Berlin' })).toBe('light')
        expect(themeForNow(utc, { timeZone: 'Asia/Tokyo' })).toBe('dark')
        expect(themeForNow(utc, { timeZone: 'America/New_York' })).toBe('light')
        expect(themeForNow(new Date('2026-07-15T11:59:00Z'), { timeZone: 'America/New_York' })).toBe('dark')
    })

    it('"device" follows the zone the browser runs in', () => {
        const device = deviceTimeZone()
        expect(themeForNow(utc, { timeZone: DEVICE_TIME_ZONE })).toBe(themeForNow(utc, { timeZone: device }))
        expect(themeForNow(utc)).toBe(themeForNow(utc, { timeZone: device }))
    })

    it('applies the custom hours in that zone', () => {
        // 14:00 Berlin with dark from 14 -> dark.
        expect(themeForNow(utc, { timeZone: 'Europe/Berlin', lightFrom: 8, darkFrom: 14 })).toBe('dark')
        expect(themeForNow(utc, { timeZone: 'Europe/Berlin', lightFrom: 8, darkFrom: 15 })).toBe('light')
    })
})

describe('resolveTimeZone', () => {
    it('maps device, empty and unknown zones to the device zone', () => {
        const device = deviceTimeZone()
        expect(resolveTimeZone(DEVICE_TIME_ZONE)).toBe(device)
        expect(resolveTimeZone('')).toBe(device)
        expect(resolveTimeZone(undefined)).toBe(device)
        expect(resolveTimeZone('Mars/Olympus_Mons')).toBe(device)
    })

    it('keeps a valid zone', () => {
        expect(resolveTimeZone('Asia/Tokyo')).toBe('Asia/Tokyo')
    })

    it('an unknown stored zone does not throw on every check', () => {
        expect(() => themeForNow(new Date(), { timeZone: 'Not/AZone' })).not.toThrow()
    })
})

describe('normalizeHour / formatHour / availableTimeZones', () => {
    it('clamps into 0-23 and rejects garbage', () => {
        expect(normalizeHour(8, 0)).toBe(8)
        expect(normalizeHour(24, 0)).toBe(0)
        expect(normalizeHour(-1, 0)).toBe(23)
        expect(normalizeHour('7', 0)).toBe(7)
        expect(normalizeHour(NaN, 8)).toBe(8)
        expect(normalizeHour(undefined, 20)).toBe(20)
        expect(normalizeHour(7.5, 8)).toBe(8)
    })

    it('does not read null, empty or false as midnight', () => {
        // A NaN hour persists to JSON as null; Number(null) would be 0.
        expect(normalizeHour(null, 8)).toBe(8)
        expect(normalizeHour('', 20)).toBe(20)
        expect(normalizeHour('  ', 20)).toBe(20)
        expect(normalizeHour(false, 8)).toBe(8)
    })

    it('formats hours as HH:00', () => {
        expect(formatHour(8)).toBe('08:00')
        expect(formatHour(20)).toBe('20:00')
    })

    it('lists Europe/Berlin among the zones', () => {
        expect(availableTimeZones()).toContain('Europe/Berlin')
    })
})

describe('normalizeTimeZoneSetting', () => {
    it('keeps device and valid zones', () => {
        expect(normalizeTimeZoneSetting(DEVICE_TIME_ZONE)).toBe(DEVICE_TIME_ZONE)
        expect(normalizeTimeZoneSetting('Asia/Tokyo')).toBe('Asia/Tokyo')
    })

    it('turns null, non-strings and unknown zones into device', () => {
        // An unknown zone would show as selected while the theme silently
        // followed the device clock.
        expect(normalizeTimeZoneSetting(null)).toBe(DEVICE_TIME_ZONE)
        expect(normalizeTimeZoneSetting(undefined)).toBe(DEVICE_TIME_ZONE)
        expect(normalizeTimeZoneSetting(42)).toBe(DEVICE_TIME_ZONE)
        expect(normalizeTimeZoneSetting('')).toBe(DEVICE_TIME_ZONE)
        expect(normalizeTimeZoneSetting('Mars/Olympus_Mons')).toBe(DEVICE_TIME_ZONE)
    })
})
