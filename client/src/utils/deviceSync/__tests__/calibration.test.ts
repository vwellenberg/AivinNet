import { describe, expect, it } from 'vitest'

import {
    agreeing,
    AGREE_MS,
    calibrationSeconds,
    measureClicks,
    planClicks,
    planEndMs,
    relativeLatencies,
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

        expect(plan.phone).toEqual([10_000, 13_600, 17_200, 20_800])
        expect(plan.pc).toEqual([11_200, 14_800, 18_400, 22_000])
        expect(plan.tablet).toEqual([12_400, 16_000, 19_600, 23_200])

        const all = Object.values(plan).flat().sort((a, b) => a - b)
        expect(all).toHaveLength(3 * ROUNDS)
        all.slice(1).forEach((t, i) => expect(t - all[i]).toBe(SLOT_MS))
        expect(planEndMs(plan)).toBe(23_200 + WINDOW_AFTER_MS)
    })

    it('looks for a click in windows that never reach into the neighbouring slot', () => {
        expect(WINDOW_BEFORE_MS + WINDOW_AFTER_MS).toBeLessThanOrEqual(SLOT_MS)
    })

    it('tells how long the room has to stay quiet', () => {
        expect(calibrationSeconds(2)).toBe(15)
        expect(calibrationSeconds(3)).toBe(20)
    })
})

/**
 * Devices as measured on 2026-09-27: a phone and a tablet whose outputs the
 * browser knows, and a Windows PC on Bluetooth that is 155 ms later than it
 * thinks. Every click also arrives `shared` ms late — microphone delay and
 * the way through the room — which is the same for all of them.
 *
 * `dropAtMs`: the recording loses `dropMs` of samples at that point, the way
 * a capture under load does — everything after it lands early.
 */
function scene(opts: {
    hidden: Record<string, number>
    shared: number
    gains?: Record<string, number>
    dropAtMs?: number
    dropMs?: number
}) {
    const ids = Object.keys(opts.hidden)
    const start = 50_000
    const plan = planClicks(ids, start)
    // Devices start their clicks a little off plan; they REPORT where they were.
    const skew = [23, -17, 8]
    const sounded: Record<string, number[]> = {}
    const arrivals: Arrival[] = []
    ids.forEach((id, d) => {
        sounded[id] = plan[id].map((t, k) => t + skew[(d + k) % skew.length] + 0.4 * k)
        sounded[id].forEach(s => {
            let at = s + opts.hidden[id] + opts.shared
            if (opts.dropAtMs !== undefined && at > opts.dropAtMs) at -= opts.dropMs ?? 0
            arrivals.push({ atMs: at, gain: opts.gains?.[id] ?? 0.3 })
        })
    })
    const recordingStart = start - 1500
    const samples = roomRecording({
        sampleRate: SR,
        startServerMs: recordingStart,
        durationMs: planEndMs(plan) + 1500 - recordingStart,
        arrivals,
        noise: 0.01,
    })
    const recording = { samples, sampleRate: SR, startServerMs: recordingStart }
    const offsets = Object.fromEntries(ids.map(id => [id, measureClicks(recording, sounded[id])]))
    return { recording, sounded, offsets, plan }
}

describe('measureClicks + relativeLatencies', () => {
    it('finds what each device hides from its browser, to the millisecond', () => {
        const { offsets } = scene({ hidden: { phone: 12, pc: 167, tablet: 40 }, shared: 35 })

        // Every click: its hidden delay plus the shared 35 ms.
        offsets.pc.forEach(ms => expect(Math.abs((ms as number) - 202)).toBeLessThan(0.5))

        const latencies = relativeLatencies(offsets)
        expect(latencies.phone).toBe(0) // heard as often as any — the first one is the reference
        expect(latencies.pc).toBeCloseTo(155, 0)
        expect(latencies.tablet).toBeCloseTo(28, 0)
        // The PC starts 155 ms earlier — the trim that made two devices sound as one by hand.
        expect(suggestTrims(latencies)).toEqual({ phone: 0, pc: 155, tablet: 28 })
    })

    it('shrugs off a recording that loses a stretch of samples halfway', () => {
        // 11 ms lost between the phone's and the PC's second click: everything
        // after it lands early, and round 2 straddles the loss. Taken device by
        // device, the medians would sit 5.5 ms off the truth (14.5 against
        // 159); round by round, only that one round is off.
        const plan = planClicks(['phone', 'pc'], 50_000)
        const { offsets } = scene({
            hidden: { phone: 0, pc: 150 },
            shared: 20,
            dropAtMs: plan.phone[1] + 20 + 300,
            dropMs: 11,
        })
        expect(offsets.phone[3]! - offsets.phone[0]!).toBeCloseTo(-11, 0)
        expect(offsets.pc[1]! - offsets.pc[0]!).toBeCloseTo(-11, 0)

        expect(relativeLatencies(offsets).pc).toBeCloseTo(150, 0)
    })

    it('hears a quiet speaker and one wired the other way round', () => {
        const { offsets } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20, gains: { phone: -0.3, pc: 0.03 } })
        expect(relativeLatencies(offsets).pc).toBeCloseTo(150, 0)
    })

    it('leaves out a device whose clicks never came — nothing is guessed for it', () => {
        const { offsets } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20, gains: { pc: 0 } })

        expect(offsets.pc).toEqual([null, null, null, null])
        expect(relativeLatencies(offsets)).toEqual({ phone: 0 })
        expect(suggestTrims(relativeLatencies(offsets))).toEqual({})
    })

    it('skips clicks whose window is not in the recording', () => {
        const { recording, sounded } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20 })
        const outside = [recording.startServerMs - 5000, ...sounded.pc.slice(1, 3), null]

        const pc = measureClicks(recording, outside)
        expect(pc[0]).toBeNull()
        expect(pc[3]).toBeNull()
        expect(pc[1]).toBeCloseTo(170, 0)
    })
})

describe('relativeLatencies', () => {
    it('takes the device heard most often as the reference', () => {
        const latencies = relativeLatencies({
            pc: [200, null, 201, null],
            phone: [50, 51, 49, 50],
        })
        expect(latencies).toEqual({ phone: 0, pc: 151 })
    })

    it('needs two rounds that agree', () => {
        expect(relativeLatencies({ phone: [50, 50, 50, 50], pc: [200, null, null, null] })).toEqual({ phone: 0 })
        expect(relativeLatencies({ phone: [50, null, null, null], pc: [200, 200, 200, 200] })).toEqual({ pc: 0 })
        expect(relativeLatencies({ phone: [50, null, null, null], pc: [null, 200, null, null] })).toEqual({})
    })
})

describe('agreeing', () => {
    it('needs two values that agree', () => {
        expect(agreeing([170.2, 170.6, 170.4])).toBeCloseTo(170.4, 6)
        expect(agreeing([170.2, null, 170.9])).toBeCloseTo(170.55, 6)
        // One stray value does not pull the result.
        expect(agreeing([170.2, 260, 170.6])).toBeCloseTo(170.4, 6)
        expect(agreeing([170, null, null])).toBeNull()
        expect(agreeing([170, 170 + 2 * AGREE_MS + 1, 400])).toBeNull()
    })
})

describe('suggestTrims', () => {
    it('lines everyone up with the earliest device, within the trim range', () => {
        expect(suggestTrims({ a: 47.4, b: 202.2 })).toEqual({ a: 0, b: 155 })
        expect(suggestTrims({ a: 0, b: 5000 })).toEqual({ a: 0, b: 1000 })
        expect(suggestTrims({ a: -20, b: 0 })).toEqual({ a: 0, b: 20 })
        expect(suggestTrims({ a: 12 })).toEqual({})
    })
})
