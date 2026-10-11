import { describe, expect, it } from 'vitest'

import { countSeparator, countUpAt, formatCount } from '@/utils/countUp'

describe('countUpAt', () => {
    it('starts at the old figure and lands exactly on the target', () => {
        expect(countUpAt(0, 1248, 0, 900)).toBe(0)
        expect(countUpAt(0, 1248, 900, 900)).toBe(1248)
        expect(countUpAt(0, 1248, 5000, 900)).toBe(1248)
    })

    it('eases out: half the time is more than half the way', () => {
        // 1 - (1 - 0.5)^3 = 0.875
        expect(countUpAt(0, 100, 450, 900)).toBe(88)
    })

    it('counts down when the figure falls', () => {
        expect(countUpAt(500, 100, 450, 900)).toBe(150)
    })

    it('never shows a fraction, and clamps a negative elapsed time', () => {
        expect(Number.isInteger(countUpAt(0, 7, 123, 900))).toBe(true)
        expect(countUpAt(40, 90, -20, 900)).toBe(40)
    })

    it('shows the target at once when there is no duration', () => {
        expect(countUpAt(0, 42, 0, 0)).toBe(42)
    })
})

describe('countSeparator', () => {
    it('reads a plain count as having no separator', () => {
        expect(countSeparator('1248')).toBe('')
        expect(countSeparator('0')).toBe('')
    })

    it('reads one grouping separator, whichever the server used', () => {
        expect(countSeparator('1,248')).toBe(',')
        expect(countSeparator('1.248')).toBe('.')
        expect(countSeparator('1 248')).toBe(' ')
        expect(countSeparator('1,248,000')).toBe(',')
    })

    it('leaves anything that is not a count alone', () => {
        expect(countSeparator('12.5')).toBeNull()
        expect(countSeparator('3 days')).toBeNull()
        expect(countSeparator('')).toBeNull()
        expect(countSeparator('2024-10-11')).toBeNull()
    })
})

describe('formatCount', () => {
    it('groups the digits the way the value arrived', () => {
        expect(formatCount(1248, ',')).toBe('1,248')
        expect(formatCount(1234567, '.')).toBe('1.234.567')
        expect(formatCount(999, ' ')).toBe('999')
        expect(formatCount(1248, '')).toBe('1248')
    })
})
