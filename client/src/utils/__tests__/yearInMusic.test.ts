import { afterEach, describe, expect, it, vi } from 'vitest'

import { DISMISSED_KEY, readDismissedYear, rememberDismissedYear, yearInMusicYear } from '@/utils/yearInMusic'

const at = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h, 0, 0, 0)
const DEC = 11

afterEach(() => {
    vi.restoreAllMocks()
    localStorage.clear()
})

describe('yearInMusicYear: the New Year\'s review card on Home (#674)', () => {
    it('shows on 31 December, for the year that is ending, when Rewind has that year', () => {
        expect(yearInMusicYear([2025, 2026], null, at(2026, DEC, 31, 9))).toBe(2026)
    })

    it('stays hidden on every other day of the year, 1 January included (the January card has that day)', () => {
        expect(yearInMusicYear([2025, 2026], null, at(2026, DEC, 30))).toBeNull()
        expect(yearInMusicYear([2025, 2026, 2027], null, at(2027, 0, 1))).toBeNull()
        expect(yearInMusicYear([2026], null, at(2026, 5, 15))).toBeNull()
    })

    it('stays hidden when Rewind has nothing for this year yet, however close it is to the end', () => {
        expect(yearInMusicYear([2025], null, at(2026, DEC, 31))).toBeNull()
        expect(yearInMusicYear([], null, at(2026, DEC, 31))).toBeNull()
    })

    it('stays away for the year it was dismissed for, and returns for the next one', () => {
        expect(yearInMusicYear([2026], 2026, at(2026, DEC, 31))).toBeNull()
        expect(yearInMusicYear([2026, 2027], 2026, at(2027, DEC, 31))).toBe(2027)
    })

    it('shows on any day when a preview asks for it, for the current year', () => {
        expect(yearInMusicYear([2026], null, at(2026, 5, 15), true)).toBe(2026)
        expect(yearInMusicYear([2025], null, at(2026, 5, 15), true)).toBeNull()
        expect(yearInMusicYear([2026], 2026, at(2026, 5, 15), true)).toBeNull()
    })
})

describe('the dismissal: localStorage, with a blocked store', () => {
    it('remembers the year it was dismissed for, and reads it back', () => {
        expect(readDismissedYear()).toBeNull()
        rememberDismissedYear(2026)
        expect(localStorage.getItem(DISMISSED_KEY)).toBe('2026')
        expect(readDismissedYear()).toBe(2026)
    })

    it('reads nothing from a value that is not a year', () => {
        localStorage.setItem(DISMISSED_KEY, 'later')
        expect(readDismissedYear()).toBeNull()
    })

    it('falls back to "not dismissed" when storage throws, and does not throw on a write', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(readDismissedYear()).toBeNull()
        expect(() => rememberDismissedYear(2026)).not.toThrow()
    })
})
