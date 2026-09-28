import { describe, expect, it } from 'vitest'

import {
    agreeing,
    AGREE_MS,
    calibrationSeconds,
    driftMsPerS,
    measureClicks,
    planClicks,
    planEndMs,
    relativeLatencies,
    ROUNDS,
    settlingDevices,
    SETTLING_MS_PER_S,
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
 *
 * `ramp`: a device's hidden delay grows by that many ms per second while it
 * clicks — a Bluetooth path on Windows right after a pause.
 */
function scene(opts: {
    hidden: Record<string, number>
    shared: number
    gains?: Record<string, number>
    dropAtMs?: number
    dropMs?: number
    ramp?: Record<string, number>
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
            const climbed = ((opts.ramp?.[id] ?? 0) * (s - start)) / 1000
            let at = s + opts.hidden[id] + climbed + opts.shared
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
    const offsets = Object.fromEntries(ids.map(id => [id, measureClicks(recording, sounded[id]).offsetsMs]))
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
        const { offsets, recording, sounded } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20, gains: { pc: 0 } })

        expect(offsets.pc).toEqual([null, null, null, null])
        // The log still says why: every window was listened to, nothing stood out.
        measureClicks(recording, sounded.pc).strengths.forEach(s => expect(s).toBeLessThan(8))
        expect(relativeLatencies(offsets)).toEqual({ phone: 0 })
        expect(suggestTrims(relativeLatencies(offsets))).toEqual({})
    })

    it('skips clicks whose window is not in the recording', () => {
        const { recording, sounded } = scene({ hidden: { phone: 0, pc: 150 }, shared: 20 })
        const outside = [recording.startServerMs - 5000, ...sounded.pc.slice(1, 3), null]

        const pc = measureClicks(recording, outside)
        expect(pc.offsetsMs[0]).toBeNull()
        expect(pc.offsetsMs[3]).toBeNull()
        expect(pc.offsetsMs[1]).toBeCloseTo(170, 0)
        // Strength says how clearly a click stood out; nothing to say outside the recording.
        expect(pc.strengths[0]).toBeNull()
        expect(pc.strengths[1]).toBeGreaterThan(20)
    })
})

describe('driftMsPerS + settlingDevices', () => {
    // Two devices, slots 1.2 s apart: the phone clicks in slot 0, the PC in slot 1.
    const sounded = (firstMs: number, rounds = 4) => Array.from({ length: rounds }, (_, k) => firstMs + k * 2 * SLOT_MS)
    const twoDevices = { phone: sounded(0), pc: sounded(SLOT_MS) }

    // The run of 2026-09-27, 23:17, as GET /devicesync/diag kept it: the PC
    // listening, Windows → Edifier M60 over Bluetooth, the phone on its own
    // speaker, the music paused for minutes. The PC's path climbed ~3 ms a
    // second while it clicked, and the run suggested +97 ms for it — the music
    // needed ~184 (measured acoustically the same night).
    const coldRun = {
        pc: [175.43, 181.88, 189.25, 197.0],
        phone: [87.89, 88.23, 88.19, 87.98],
    }

    it('reads a path still climbing after a pause as settling — not as a latency', () => {
        expect(driftMsPerS(coldRun.pc, twoDevices.pc)).toBeCloseTo(3.1, 1)
        expect(Math.abs(driftMsPerS(coldRun.phone, twoDevices.phone) as number)).toBeLessThan(0.2)
        expect(settlingDevices(coldRun, twoDevices)).toEqual(['pc'])
    })

    it('lets a steady path through — the same PC right after 35 s of music', () => {
        // Measured the same night with the external listener: flat within 2.5 ms over 12 s.
        const warmPc = [315.96, 316.17, 317.35, 317.96, 317.78, 318.45]
        const warmPhone = [119.8, 119.01, 119.65, 120.21, 120.09, 118.65]
        const drift = driftMsPerS(warmPc, sounded(SLOT_MS, 6)) as number
        expect(Math.abs(drift)).toBeLessThan(SETTLING_MS_PER_S)
        expect(
            settlingDevices({ pc: warmPc, phone: warmPhone }, { pc: sounded(SLOT_MS, 6), phone: sounded(0, 6) })
        ).toEqual([])
    })

    it('one stray click neither makes a device settle nor hides one that does', () => {
        // The 77-ms run of that night: the PC's last window caught something else.
        expect(driftMsPerS([161.18, 168.71, 176.31, -83.3], twoDevices.pc)).toBeCloseTo(3.1, 1)
        expect(Math.abs(driftMsPerS([88, 88.2, -150, 88.1], twoDevices.phone) as number)).toBeLessThan(0.2)
    })

    it('does not blame the devices for a recording that lost a stretch of samples', () => {
        const plan = planClicks(['phone', 'pc'], 50_000)
        const { offsets, sounded: reported } = scene({
            hidden: { phone: 0, pc: 150 },
            shared: 20,
            dropAtMs: plan.phone[1] + 20 + 300,
            dropMs: 11,
        })
        expect(settlingDevices(offsets, reported)).toEqual([])
    })

    it('takes movement every device shares as the listener’s own clock, not theirs', () => {
        const shared = (ms: number[], at: number[]) => ms.map((v, k) => v + (2.5 * (at[k] - at[0])) / 1000)
        const steady = {
            phone: shared([50, 50, 50, 50], twoDevices.phone),
            pc: shared([200, 200, 200, 200], twoDevices.pc),
        }
        expect(settlingDevices(steady, twoDevices)).toEqual([])

        const climbing = { ...steady, pc: shared(coldRun.pc, twoDevices.pc) }
        expect(settlingDevices(climbing, twoDevices)).toEqual(['pc'])
    })

    it('judges a device only on three clicks it was heard with', () => {
        expect(driftMsPerS([100, null, 130, null], twoDevices.pc)).toBeNull()
        // A click the device could not place does not count either.
        expect(driftMsPerS([100, 110, 120, 130], [0, null, null, 7200])).toBeNull()
        expect(settlingDevices({ pc: [100, null, 130, null], phone: [50, 50, 50, 50] }, twoDevices)).toEqual([])
    })

    it('finds the climb in a real recording, click by click', () => {
        const { offsets, sounded: reported } = scene({
            hidden: { phone: 12, pc: 150 },
            shared: 35,
            ramp: { pc: 3 },
        })
        expect(driftMsPerS(offsets.pc, reported.pc)).toBeCloseTo(3, 0)
        expect(settlingDevices(offsets, reported)).toEqual(['pc'])
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
