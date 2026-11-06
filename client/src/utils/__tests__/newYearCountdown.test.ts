import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    CELEBRATED_KEY,
    CELEBRATION_MS,
    clockText,
    countdownAt,
    newYearConfettiYear,
    readCelebratedYear,
    rememberCelebratedYear,
} from '@/utils/newYearCountdown'

// Local wall-clock dates, fixed. Month is 0-based in the Date constructor.
const at = (y: number, m: number, d: number, h = 12, min = 0, s = 0, ms = 0) => new Date(y, m, d, h, min, s, ms)
const DEC = 11
const JAN = 0

describe('countdownAt: the top bar on New Year\'s Eve', () => {
    it('shows nothing before 18:00 on 31 December, and at 17:59:59.999', () => {
        expect(countdownAt(at(2026, DEC, 31, 0, 0))).toEqual({ kind: 'none' })
        expect(countdownAt(at(2026, DEC, 31, 17, 59, 59, 999))).toEqual({ kind: 'none' })
    })

    it('starts counting at 18:00 with six hours to go', () => {
        expect(countdownAt(at(2026, DEC, 31, 18, 0, 0, 0))).toEqual({ kind: 'counting', remainingMs: 6 * 60 * 60 * 1000 })
    })

    it('counts the time left to midnight, to the millisecond', () => {
        expect(countdownAt(at(2026, DEC, 31, 23, 59, 59, 0))).toEqual({ kind: 'counting', remainingMs: 1000 })
        expect(countdownAt(at(2026, DEC, 31, 23, 59, 59, 500))).toEqual({ kind: 'counting', remainingMs: 500 })
    })

    it('shows nothing on the other days, the last of December included', () => {
        expect(countdownAt(at(2026, DEC, 30, 23, 0))).toEqual({ kind: 'none' })
        expect(countdownAt(at(2027, JAN, 2, 19, 0))).toEqual({ kind: 'none' })
        expect(countdownAt(at(2026, 5, 15, 19, 0))).toEqual({ kind: 'none' })
    })

    it('greets the new year in its first hour, from the very first millisecond', () => {
        expect(countdownAt(at(2027, JAN, 1, 0, 0, 0, 0))).toEqual({ kind: 'celebrating' })
        expect(countdownAt(at(2027, JAN, 1, 0, 59, 59, 999))).toEqual({ kind: 'celebrating' })
    })

    it('shows nothing once the first hour of 1 January is over', () => {
        expect(countdownAt(at(2027, JAN, 1, 1, 0, 0, 0))).toEqual({ kind: 'none' })
        expect(CELEBRATION_MS).toBe(60 * 60 * 1000)
    })

    it('counts to the next midnight in a preview, on any day and hour', () => {
        expect(countdownAt(at(2026, 5, 15, 12, 0, 0), true)).toEqual({ kind: 'counting', remainingMs: 12 * 60 * 60 * 1000 })
        expect(countdownAt(at(2026, DEC, 31, 23, 59, 59, 0), true)).toEqual({ kind: 'counting', remainingMs: 1000 })
        expect(countdownAt(at(2027, JAN, 1, 0, 30), true)).toEqual({ kind: 'counting', remainingMs: 23.5 * 60 * 60 * 1000 })
    })
})

describe('clockText: hh:mm:ss, rounded up to the second', () => {
    it('reads the time left as two digits a field', () => {
        expect(clockText(6 * 60 * 60 * 1000)).toBe('06:00:00')
        expect(clockText((1 * 3600 + 2 * 60 + 3) * 1000)).toBe('01:02:03')
    })

    it('reads 00:00:01 at the last second before midnight, never 00:00:00 before it', () => {
        expect(clockText(1000)).toBe('00:00:01')
        expect(clockText(1)).toBe('00:00:01')
        expect(clockText(999)).toBe('00:00:01')
    })

    it('reads 00:00:00 only at zero, and never below it', () => {
        expect(clockText(0)).toBe('00:00:00')
        expect(clockText(-500)).toBe('00:00:00')
    })
})

describe('newYearConfettiYear: the confetti is due on 1 January, once per year', () => {
    it('fires for the new year at midnight, the first tick of 1 January', () => {
        expect(newYearConfettiYear(at(2027, JAN, 1, 0, 0, 0, 0), null)).toBe(2027)
        expect(newYearConfettiYear(at(2027, JAN, 1, 0, 0, 1, 0), null)).toBe(2027)
    })

    it('fires later on 1 January too, not only in the first hour', () => {
        expect(newYearConfettiYear(at(2027, JAN, 1, 15, 30, 0, 0), null)).toBe(2027)
    })

    it('does not fire again for a year it already fired for, the rest of 1 January included', () => {
        expect(newYearConfettiYear(at(2027, JAN, 1, 0, 0, 1, 0), 2027)).toBeNull()
        expect(newYearConfettiYear(at(2027, JAN, 1, 15, 30, 0, 0), 2027)).toBeNull()
    })

    it('does not fire on 31 December, even in the last second before midnight', () => {
        expect(newYearConfettiYear(at(2026, DEC, 31, 23, 59, 59, 0), null)).toBeNull()
    })

    it('does not fire on 2 January', () => {
        expect(newYearConfettiYear(at(2027, JAN, 2, 9, 0, 0, 0), null)).toBeNull()
    })

    it('fires when the remembered year is last year', () => {
        expect(newYearConfettiYear(at(2027, JAN, 1, 9, 0, 0, 0), 2026)).toBe(2027)
    })
})

describe('the remembered year: localStorage, with a blocked store', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    afterEach(() => {
        vi.restoreAllMocks()
        localStorage.clear()
    })

    it('remembers the year it fired for, and reads it back', () => {
        expect(readCelebratedYear()).toBeNull()
        rememberCelebratedYear(2027)
        expect(localStorage.getItem(CELEBRATED_KEY)).toBe('2027')
        expect(readCelebratedYear()).toBe(2027)
    })

    it('reads nothing from a value that is not a year', () => {
        localStorage.setItem(CELEBRATED_KEY, 'yes')
        expect(readCelebratedYear()).toBeNull()
    })

    it('falls back to "nothing remembered" when storage throws (private window)', () => {
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('blocked')
        })
        expect(readCelebratedYear()).toBeNull()
    })

    it('does not throw when storage refuses the write', () => {
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('quota')
        })
        expect(() => rememberCelebratedYear(2027)).not.toThrow()
    })
})
