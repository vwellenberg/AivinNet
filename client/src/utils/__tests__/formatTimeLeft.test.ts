import { describe, expect, it } from 'vitest'

import formatTimeLeft from '@/utils/formatTimeLeft'

// The time left on a Continue card (2026-11-20): "Some Band · 2019 · 38 min left".
describe('formatTimeLeft', () => {
    it('says minutes under an hour, rounded', () => {
        expect(formatTimeLeft(38 * 60)).toBe('38 min')
        expect(formatTimeLeft(38 * 60 + 31)).toBe('39 min')
    })

    it('never says 0 min for something that is left', () => {
        expect(formatTimeLeft(12)).toBe('1 min')
    })

    it('adds hours, and drops the minutes on the full hour', () => {
        expect(formatTimeLeft(72 * 60)).toBe('1 h 12 min')
        expect(formatTimeLeft(120 * 60)).toBe('2 h')
        expect(formatTimeLeft(119 * 60 + 40)).toBe('2 h') // rounds up into the next hour
    })

    it('is empty for nothing, so the caller drops the part', () => {
        expect(formatTimeLeft(0)).toBe('')
        expect(formatTimeLeft(undefined)).toBe('')
        expect(formatTimeLeft(null)).toBe('')
        expect(formatTimeLeft(Number.NaN)).toBe('')
    })
})
