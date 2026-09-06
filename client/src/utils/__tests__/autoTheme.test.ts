import { describe, expect, it } from 'vitest'

import { berlinHour, DARK_FROM_HOUR, LIGHT_FROM_HOUR, themeForHour, themeForNow } from '@/utils/autoTheme'

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

describe('berlinHour', () => {
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
        expect(berlinHour(utcNoon, 'Asia/Tokyo')).toBe(21)
        expect(berlinHour(utcNoon)).toBe(14)
    })
})

describe('themeForNow', () => {
    it('is dark late in the Berlin evening even when UTC still reads afternoon', () => {
        // 18:30 UTC in summer = 20:30 in Berlin -> already dark.
        expect(themeForNow(new Date('2026-07-15T18:30:00Z'))).toBe('dark')
    })

    it('is light during the Berlin day', () => {
        expect(themeForNow(new Date('2026-07-15T10:00:00Z'))).toBe('light')
    })

    it('is dark early in the Berlin morning', () => {
        // 04:00 UTC summer = 06:00 Berlin.
        expect(themeForNow(new Date('2026-07-15T04:00:00Z'))).toBe('dark')
    })
})
