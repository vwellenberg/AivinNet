import { describe, expect, it } from 'vitest'
import { computeCorrection, DEADBAND_MS, MAX_RATE_DELTA, SEEK_MS } from '../driftSteer'

// The error is device position minus expected position (ms): > 0 is ahead.

const rateOf = (errorMs: number) => {
    const c = computeCorrection(errorMs)
    if (c.action !== 'rate') throw new Error(`expected a rate for ${errorMs} ms, got ${c.action}`)
    return c.rate
}

describe('computeCorrection', () => {
    it('runs at exactly 1.0 inside the deadband', () => {
        expect(rateOf(0)).toBe(1)
        expect(rateOf(DEADBAND_MS - 0.5)).toBe(1)
        expect(rateOf(-(DEADBAND_MS - 0.5))).toBe(1)
    })

    it('already corrects a few ms — 20 ms between two devices is audible', () => {
        // The old time-stretch policy left anything under 25 ms alone.
        expect(rateOf(-5)).toBeCloseTo(1.0025, 6) // behind → faster
        expect(rateOf(5)).toBeCloseTo(0.9975, 6) // ahead → slower
    })

    it('is proportional and clamps at ±0.5 % (8.6 cents when resampling)', () => {
        expect(rateOf(-8)).toBeCloseTo(1.004, 6)
        expect(rateOf(-20)).toBeCloseTo(1 + MAX_RATE_DELTA, 6)
        expect(rateOf(SEEK_MS)).toBeCloseTo(1 - MAX_RATE_DELTA, 6)
    })

    it('seeks beyond 40 ms instead of steering for eight seconds', () => {
        expect(computeCorrection(SEEK_MS + 1)).toEqual({ action: 'seek' })
        expect(computeCorrection(-400)).toEqual({ action: 'seek' })
    })
})
