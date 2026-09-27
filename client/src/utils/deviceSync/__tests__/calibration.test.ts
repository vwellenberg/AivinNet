import { describe, expect, it } from 'vitest'

import {
    agreeing,
    AGREE_MS,
    measureClicks,
    planClicks,
    planEndMs,
    ROUNDS,
    SLOT_MS,
    suggestTrims,
    WINDOW_AFTER_MS,
    WINDOW_BEFORE_MS,
} from '@/utils/deviceSync/calibration'
import { roomRecording, type Arrival } from './calibrationSignal'

const SR = 48000

describe('planClicks', () => {
    it('gives every device one slot per round, one device at a time', () => {
        const plan = planClicks(['phone', 'pc', 'tablet'], 10_000)

        expect(plan.phone).toEqual([10_000, 13_600, 17_200])
        expect(plan.pc).toEqual([11_200, 14_800, 18_400])
        expect(plan.tablet).toEqual([12_400, 16_000, 19_600])

        const all = Object.values(plan).flat().sort((a, b) => a - b)
        expect(all).toHaveLength(3 * ROUNDS)
        all.slice(1).forEach((t, i) => expect(t - all[i]).toBe(SLOT_MS))
        expect(planEndMs(plan)).toBe(19_600 + WINDOW_AFTER_MS)
    })

    it('looks for a click in windows that never reach into the neighbouring slot', () => {
        expect(WINDOW_BEFORE_MS + WINDOW_AFTER_MS).toBeLessThanOrEqual(SLOT_MS)
    })
})

/**
 * Three devices as measured on 2026-09-27: a phone and a tablet whose outputs
 * the browser knows, and a Windows PC on Bluetooth that is 155 ms later than
 * it thinks. Every click also arrives `shared` ms late — microphone delay and
 * the way through the room — which is the same for all of them.
 */
function scene(opts: { hidden: Record<string, number>; shared: number; gains?: Record<string, number> }) {
    const ids = Object.keys(opts.hidden)
    const start = 50_000
    const plan = planClicks(ids, start)
    // Devices start their clicks a little off plan; they REPORT where they were.
    const skew = [23, -17, 8]
    const sounded: Record<string, number[]> = {}
    const arrivals: Arrival[] = []
    ids.forEach((id, d) => {
        sounded[id] = plan[id].map((t, k) => t + skew[(d + k) % skew.length] + 0.4 * k)
        sounded[id].forEach(s =>
            arrivals.push({ atMs: s + opts.hidden[id] + opts.shared, gain: opts.gains?.[id] ?? 0.3 })
        )
    })
    const recordingStart = start - 1500
    const samples = roomRecording({
        sampleRate: SR,
        startServerMs: recordingStart,
        durationMs: planEndMs(plan) + 1500 - recordingStart,
        arrivals,
        noise: 0.01,
    })
    return { recording: { samples, sampleRate: SR, startServerMs: recordingStart }, sounded }
}

describe('measureClicks', () => {
    it('finds what each device hides from its browser, to the millisecond', () => {
        const hidden = { phone: 12, pc: 167, tablet: 40 }
        const { recording, sounded } = scene({ hidden, shared: 35 })

        const latencies = Object.fromEntries(
            Object.keys(hidden).map(id => [id, measureClicks(recording, sounded[id]).latencyMs])
        )
        for (const [id, ms] of Object.entries(hidden)) {
            expect(latencies[id]).not.toBeNull()
            expect(Math.abs((latencies[id] as number) - (ms + 35))).toBeLessThan(0.5)
        }

        // The earliest is the reference; the PC starts 155 ms earlier — the trim
        // that made the two sound as one by hand.
        expect(suggestTrims(latencies as Record<string, number>)).toEqual({ phone: 0, pc: 155, tablet: 28 })
    })

    it('hears a quiet speaker and one wired the other way round', () => {
        const hidden = { phone: 0, pc: 150 }
        const { recording, sounded } = scene({ hidden, shared: 20, gains: { phone: -0.3, pc: 0.03 } })

        expect(measureClicks(recording, sounded.phone).latencyMs).toBeCloseTo(20, 0)
        expect(measureClicks(recording, sounded.pc).latencyMs).toBeCloseTo(170, 0)
    })

    it('reports a device whose clicks never came as unmeasured, not as a number', () => {
        const { recording, sounded } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20, gains: { pc: 0 } })

        const pc = measureClicks(recording, sounded.pc)
        expect(pc.latencyMs).toBeNull()
        expect(pc.offsetsMs).toEqual([null, null, null])
    })

    it('skips clicks whose window is not in the recording', () => {
        const { recording, sounded } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20 })
        const outside = [recording.startServerMs - 5000, ...sounded.pc.slice(1), null]

        const pc = measureClicks(recording, outside)
        expect(pc.offsetsMs[0]).toBeNull()
        expect(pc.offsetsMs[3]).toBeNull()
        expect(pc.latencyMs).toBeCloseTo(170, 0)
    })
})

describe('agreeing', () => {
    it('needs two clicks that agree', () => {
        expect(agreeing([170.2, 170.6, 170.4])).toBeCloseTo(170.4, 6)
        expect(agreeing([170.2, null, 170.9])).toBeCloseTo(170.55, 6)
        // One stray reading does not pull the result.
        expect(agreeing([170.2, 260, 170.6])).toBeCloseTo(170.4, 6)
        expect(agreeing([170, null, null])).toBeNull()
        expect(agreeing([170, 170 + 2 * AGREE_MS + 1, 400])).toBeNull()
    })
})

describe('suggestTrims', () => {
    it('lines everyone up with the earliest device, within the trim range', () => {
        expect(suggestTrims({ a: 47.4, b: 202.2 })).toEqual({ a: 0, b: 155 })
        expect(suggestTrims({ a: 0, b: 5000 })).toEqual({ a: 0, b: 1000 })
        expect(suggestTrims({ a: 12 })).toEqual({})
    })
})
