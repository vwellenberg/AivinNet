import { describe, expect, it } from 'vitest'

import { clockStats, playMeasurement, soundedAt, tickRate, type Reading } from '@/utils/deviceSync/clickPlayer'

/** A media clock read every 25 ms: position 0 sounded at `origin`, plus Firefox-like jitter. */
function readings(origin: number, fromMedia: number, count: number, jitter = 0): Reading[] {
    return Array.from({ length: count }, (_, i) => {
        const media = fromMedia + i * 25
        const noise = jitter ? ((i * 7919) % 81) - 40 : 0 // deterministic ±40 ms
        return { at: origin + media + (noise * jitter) / 40, media }
    })
}

describe('soundedAt', () => {
    it('says when a media position sounded on the wall clock', () => {
        expect(soundedAt(readings(1_000_000, 0, 60), 900)).toBeCloseTo(1_000_900, 6)
    })

    it('takes the median, so a jittery clock does not move the answer much', () => {
        const at = soundedAt(readings(1_000_000, 0, 100, 40), 1200) as number
        expect(Math.abs(at - 1_001_200)).toBeLessThan(10)
    })

    it('only trusts readings near the click, and wants enough of them', () => {
        // Readings from far away in the file do not describe this click...
        expect(soundedAt(readings(1_000_000, 10_000, 60), 900)).toBeNull()
        // ...and four readings are too few.
        expect(soundedAt(readings(1_000_000, 800, 4), 900)).toBeNull()
    })
})

describe('tickRate', () => {
    it('slows an early device and speeds up a late one, gently and within 5 %', () => {
        expect(tickRate(0.5)).toBe(1) // inside the deadband
        expect(tickRate(8)).toBeCloseTo(0.99, 6) // 8 ms early: 1 % slower
        expect(tickRate(-8)).toBeCloseTo(1.01, 6)
        expect(tickRate(400)).toBeCloseTo(0.95, 6)
        expect(tickRate(-400)).toBeCloseTo(1.05, 6)
    })
})

describe('playMeasurement', () => {
    const clock = { serverNow: () => 100_000, offset: () => 0 }
    const signal = new AbortController().signal

    it('answers "muted" instead of clicking into silence', async () => {
        const result = await playMeasurement({
            clicksServerMs: [103_000],
            clock,
            volume: 0,
            startLatencyMs: 50,
            signal,
        })
        expect(result).toEqual({ error: 'muted' })
    })

    it('answers "late" when the plan arrives too close to its first click', async () => {
        const result = await playMeasurement({
            clicksServerMs: [100_300],
            clock,
            volume: 1,
            startLatencyMs: 50,
            signal,
        })
        expect(result).toEqual({ error: 'late' })
    })
})

describe('clockStats', () => {
    it('reads a steady media clock as steady', () => {
        expect(clockStats(readings(1_000_000, 0, 200))).toEqual({ spreadMs: 0, driftMs: 0 })
    })

    it('shows a clock whose reported delay settles while it plays as drift', () => {
        // The first second 40 ms off, then 40 ms less: a latency estimate that
        // changes under a fresh element.
        const settling = readings(1_000_000, 0, 200).map(r => (r.media < 1000 ? { ...r, at: r.at - 40 } : r))
        expect(clockStats(settling).driftMs).toBeCloseTo(40, 0)
    })

    it('says nothing with too few readings, and no drift over too short a run', () => {
        expect(clockStats(readings(1_000_000, 0, 4))).toEqual({ spreadMs: null, driftMs: null })
        expect(clockStats(readings(1_000_000, 0, 60)).driftMs).toBeNull() // 1.5 s
    })
})

