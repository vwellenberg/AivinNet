import { beforeEach, describe, expect, it } from 'vitest'
import {
    DEFAULT_LATENCY,
    learnLatency,
    loadLatency,
    MAX_LATENCY_MS,
    MAX_RESIDUAL_MS,
    saveLatency,
} from '../latency'

describe('learnLatency', () => {
    it('raises the estimate when the device landed behind', () => {
        // Assumed 90 ms, landed 50 ms behind: the delay was ~140 ms.
        expect(learnLatency(90, -50)).toBe(120)
    })

    it('lowers it when the device landed ahead', () => {
        expect(learnLatency(90, 40)).toBe(66)
    })

    it('converges on the true delay over a few actions', () => {
        const truth = 140
        let estimate = DEFAULT_LATENCY.seek
        for (let i = 0; i < 6; i++) estimate = learnLatency(estimate, estimate - truth)
        expect(Math.abs(estimate - truth)).toBeLessThanOrEqual(1)
    })

    it('never learns from a stall — a residual beyond the cap is not a latency', () => {
        expect(learnLatency(90, -(MAX_RESIDUAL_MS + 1))).toBe(90)
        expect(learnLatency(90, Number.NaN)).toBe(90)
    })

    it('stays within 0..MAX', () => {
        expect(learnLatency(10, 200)).toBe(0)
        expect(learnLatency(MAX_LATENCY_MS, -300)).toBe(MAX_LATENCY_MS)
    })
})

describe('persistence', () => {
    beforeEach(() => localStorage.clear())

    it('starts from the defaults on a device that never measured itself', () => {
        expect(loadLatency()).toEqual(DEFAULT_LATENCY)
    })

    it('keeps what a device learned across reloads', () => {
        saveLatency({ start: 45, seek: 130 })
        expect(loadLatency()).toEqual({ start: 45, seek: 130 })
    })

    it('falls back per field on garbage instead of trusting it', () => {
        localStorage.setItem('aivinnet.sync_latency', JSON.stringify({ start: 'x', seek: 99999 }))
        expect(loadLatency()).toEqual({ start: DEFAULT_LATENCY.start, seek: MAX_LATENCY_MS })

        localStorage.setItem('aivinnet.sync_latency', '{not json')
        expect(loadLatency()).toEqual(DEFAULT_LATENCY)
    })
})
