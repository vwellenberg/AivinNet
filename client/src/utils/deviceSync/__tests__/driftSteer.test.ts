import { describe, expect, it } from 'vitest'
import { computeCorrection, ENGAGE_MS, RELEASE_MS, SEEK_MS } from '../driftSteer'

// The error is device position minus expected position (ms): > 0 is ahead.

describe('computeCorrection', () => {
    it('leaves a small error alone while not steering (both signs)', () => {
        expect(computeCorrection(0, false)).toEqual({ action: 'none' })
        expect(computeCorrection(15, false)).toEqual({ action: 'none' })
        expect(computeCorrection(-15, false)).toEqual({ action: 'none' })
        expect(computeCorrection(ENGAGE_MS - 1, false)).toEqual({ action: 'none' })
    })

    it('engages above 20 ms — two devices 40 ms apart comb-filter audibly', () => {
        const c = computeCorrection(-25, false)
        expect(c.action).toBe('rate')
        if (c.action === 'rate') expect(c.rate).toBeGreaterThan(1)
    })

    it('once engaged, keeps steering well below the engage threshold (hysteresis)', () => {
        // Releasing at 20 ms parked every device at the edge of the band.
        const c = computeCorrection(12, true)
        expect(c.action).toBe('rate')
        if (c.action === 'rate') expect(c.rate).toBeLessThan(1)

        expect(computeCorrection(RELEASE_MS - 1, true)).toEqual({ action: 'none' })
        expect(computeCorrection(-(RELEASE_MS - 1), true)).toEqual({ action: 'none' })
    })

    it('slows down when ahead, speeds up when behind, proportionally', () => {
        // +60 → 60/1000*0.5 = 0.03 → rate 0.97
        const ahead = computeCorrection(60, false)
        expect(ahead.action).toBe('rate')
        if (ahead.action === 'rate') expect(ahead.rate).toBeCloseTo(0.97, 6)

        // -40 → -0.02 → rate 1.02
        const behind = computeCorrection(-40, false)
        if (behind.action === 'rate') expect(behind.rate).toBeCloseTo(1.02, 6)
    })

    it('clamps the rate at ±4 %', () => {
        // +100 → 0.05 → clamped → 0.96
        const c = computeCorrection(100, true)
        if (c.action === 'rate') expect(c.rate).toBeCloseTo(0.96, 6)

        const c2 = computeCorrection(-SEEK_MS, true)
        expect(c2.action).toBe('rate')
        if (c2.action === 'rate') expect(c2.rate).toBeCloseTo(1.04, 6)
    })

    it('seeks beyond 150 ms instead of easing seconds of echo out', () => {
        // At 4 % a 150 ms offset takes four seconds to close — the old 1 s
        // threshold meant up to 25 s of audible echo.
        expect(computeCorrection(SEEK_MS + 1, false)).toEqual({ action: 'seek' })
        expect(computeCorrection(-400, true)).toEqual({ action: 'seek' })
        expect(computeCorrection(-4000, false)).toEqual({ action: 'seek' })
    })
})
