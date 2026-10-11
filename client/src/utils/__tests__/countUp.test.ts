import { describe, expect, it } from 'vitest'

import { countTokens, countUpAt, formatCount, renderCounts } from '@/utils/countUp'

// The values below are the shapes the stats page really sends: a count with a
// unit (`408 track plays`), a count split over two units, a grouped figure, and
// the top tiles' titles, where a number is part of a name.
const STAT_VALUES = [
    '408 track plays',
    '12 hrs, 49 mins listened',
    '30 new favorites',
    '1,248 streams',
    '1.234.567 bytes',
    '02. Auf Den Strassen - Gerhard Ottmer',
]

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

describe('countTokens', () => {
    it('finds each count in the text, with its value and grouping', () => {
        expect(countTokens('1,248 streams')).toEqual([{ start: 0, end: 5, value: 1248, separator: ',' }])
        expect(countTokens('408 track plays')).toEqual([{ start: 0, end: 3, value: 408, separator: '' }])
    })

    it('counts every number of a multi-unit value', () => {
        const tokens = countTokens('12 hrs, 49 mins listened')
        expect(tokens.map(t => t.value)).toEqual([12, 49])
    })

    it('leaves track numbers and decimals as written', () => {
        expect(countTokens('02. Auf Den Strassen')).toEqual([])
        expect(countTokens('12.5 hrs')).toEqual([])
    })

    it('finds nothing in a value without numbers', () => {
        expect(countTokens('Gerhard Ottmer')).toEqual([])
    })
})

describe('renderCounts', () => {
    it('puts the figures into the text and keeps the words', () => {
        const raw = '12 hrs, 49 mins listened'
        expect(renderCounts(raw, countTokens(raw), [3, 7])).toBe('3 hrs, 7 mins listened')
    })

    it('renders the target figures back to the value as it arrived', () => {
        for (const raw of STAT_VALUES) {
            const tokens = countTokens(raw)
            expect(renderCounts(raw, tokens, tokens.map(t => t.value))).toBe(raw)
        }
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
