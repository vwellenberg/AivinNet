import { describe, expect, it } from 'vitest'
import { computeCorrection, ENGAGE_MS, MAX_RATE_DELTA, MIN_RATE_DELTA, RELEASE_MS, SEEK_MS } from '../driftSteer'

// The error is device position minus expected position (ms): > 0 is ahead.

describe('computeCorrection', () => {
    it('leaves an error under the engage threshold alone (a steering cycle would cost as much)', () => {
        expect(computeCorrection(0, false)).toEqual({ action: 'none' })
        expect(computeCorrection(20, false)).toEqual({ action: 'none' })
        expect(computeCorrection(-20, false)).toEqual({ action: 'none' })
        expect(computeCorrection(ENGAGE_MS - 1, false)).toEqual({ action: 'none' })
    })

    it('engages above 25 ms', () => {
        const behind = computeCorrection(-30, false)
        expect(behind.action).toBe('rate')
        if (behind.action === 'rate') expect(behind.rate).toBeGreaterThan(1)

        const ahead = computeCorrection(30, false)
        if (ahead.action === 'rate') expect(ahead.rate).toBeLessThan(1)
    })

    it('once engaged, keeps steering well below the engage threshold (hysteresis)', () => {
        expect(computeCorrection(12, true).action).toBe('rate')
        expect(computeCorrection(RELEASE_MS - 1, true)).toEqual({ action: 'none' })
        expect(computeCorrection(-(RELEASE_MS - 1), true)).toEqual({ action: 'none' })
    })

    it('never steers gentler than 2 % — 1 % did not even pay for its own priming', () => {
        const c = computeCorrection(-12, true)
        expect(c.action).toBe('rate')
        if (c.action === 'rate') expect(c.rate).toBeCloseTo(1 + MIN_RATE_DELTA, 6)
    })

    it('is proportional in between and clamps at 4 %', () => {
        // -60 → 60/1000*0.5 = 0.03 → rate 1.03
        const c = computeCorrection(-60, false)
        if (c.action === 'rate') expect(c.rate).toBeCloseTo(1.03, 6)

        const c2 = computeCorrection(SEEK_MS, true)
        expect(c2.action).toBe('rate')
        if (c2.action === 'rate') expect(c2.rate).toBeCloseTo(1 - MAX_RATE_DELTA, 6)
    })

    it('seeks beyond 100 ms instead of steering seconds of echo out', () => {
        expect(computeCorrection(SEEK_MS + 1, false)).toEqual({ action: 'seek' })
        expect(computeCorrection(-400, true)).toEqual({ action: 'seek' })
        expect(computeCorrection(-4000, false)).toEqual({ action: 'seek' })
    })
})
