import { describe, expect, it } from 'vitest'

import { formatSince, formatUptime, isServerCardQuery } from '../serverCard'

describe('isServerCardQuery (#547)', () => {
    it('opens on "aivin", whatever the case and the spaces around it', () => {
        expect(isServerCardQuery('aivin')).toBe(true)
        expect(isServerCardQuery('AIVIN')).toBe(true)
        expect(isServerCardQuery('  Aivin ')).toBe(true)
    })

    it('stays closed for anything that only contains it', () => {
        expect(isServerCardQuery('aivin music')).toBe(false)
        expect(isServerCardQuery('aiv')).toBe(false)
        expect(isServerCardQuery('')).toBe(false)
        expect(isServerCardQuery(null)).toBe(false)
        expect(isServerCardQuery(undefined)).toBe(false)
    })
})

describe('formatUptime', () => {
    it('shows the two largest units', () => {
        expect(formatUptime(3 * 86400 + 5 * 3600 + 59)).toBe('3 d 5 h')
        expect(formatUptime(5 * 3600 + 12 * 60)).toBe('5 h 12 min')
        expect(formatUptime(42 * 60 + 30)).toBe('42 min')
        expect(formatUptime(30)).toBe('30 s')
    })

    it('reads zero and nonsense as zero seconds', () => {
        expect(formatUptime(0)).toBe('0 s')
        expect(formatUptime(-5)).toBe('0 s')
    })
})

describe('formatSince', () => {
    it('is null while the server has not counted the oldest play', () => {
        expect(formatSince(null)).toBeNull()
    })

    it('reads the oldest play as a date', () => {
        // Noon UTC, so no time zone moves it to another day.
        expect(formatSince(Date.UTC(2025, 2, 3, 12) / 1000)).toBe('March 3, 2025')
    })
})
