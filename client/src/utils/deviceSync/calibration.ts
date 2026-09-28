// Sync calibration, the arithmetic: who clicks when, where to look for each
// click in the recording, and what trims follow from what was heard.
//
// Every device reports when each of its clicks left the speaker by its OWN
// media clock (the clock the group steering aligns). The listening device
// hears when it really arrived. The difference is what the browser cannot
// see — Bluetooth on Windows, a soundbar's DSP — plus a constant shared by
// every device (microphone latency, sound travel to the listener). Only the
// differences between devices count, so that constant drops out.
//
// Measured end to end (two Chromium devices on one PipeWire null sink, one of
// them behind a 150 ms delay its browser knows nothing about): 150 ms found
// to ±3 ms in 7 of 8 runs. The rest is the browsers' own media clocks, which
// now and then sit up to ~8 ms off what actually sounds — the music shares
// that floor, so a smaller correction is not a correction (see NO_CHANGE_MS
// in stores/syncCalibration.ts).
//
// A real room adds what no null sink has: a delay that is still MOVING. A
// Bluetooth path on Windows is ~150 ms shorter right after a pause than under
// music and climbs back while it plays — so the clicks go over the music,
// turned down, and a device whose clicks still drift gets no trim
// (`settlingDevices`).

import { chirp, CHIRP_BAND_HZ } from './clickSignal'
import { clampOffset } from './audioOffset'
import { correlationEnvelope, findArrival } from './clickDetect'

/** Time between two clicks in the plan (ms): one device at a time, the room quiet again in between. */
export const SLOT_MS = 1200
/** Clicks per device; a result needs two rounds that agree. */
export const ROUNDS = 4
/** From the start to the first click (ms): every device has to hear of the plan — a poll away — and start playing. */
export const PREP_MS = 3000
/**
 * The window a click is looked for in, around its reported time (ms). Early
 * side: clock error. Late side: what the browser does not see, the
 * microphone's own delay and the way to the listener. Together one slot, so
 * the windows of neighbouring clicks never overlap.
 */
export const WINDOW_BEFORE_MS = 350
export const WINDOW_AFTER_MS = SLOT_MS - WINDOW_BEFORE_MS
/** A click counts as heard at this strength (see `findArrival`; noise alone stays near 3). */
export const MIN_STRENGTH = 8
/** Rounds agree when their differences lie this close (ms). */
export const AGREE_MS = 5
/**
 * A device whose delay moves faster than this (ms per second) while it clicks
 * is still settling. Measured 2026-09-27: a Windows → Bluetooth path climbing
 * after a pause moved ~3 ms/s; the same path under music, and a phone on its
 * own speaker, stayed within ~0.3 ms/s.
 */
export const SETTLING_MS_PER_S = 1

/** Each device's click times (server ms): device i clicks in slot i of every round. */
export function planClicks(deviceIds: string[], startServerMs: number, rounds = ROUNDS): Record<string, number[]> {
    const n = deviceIds.length
    const plan: Record<string, number[]> = {}
    deviceIds.forEach((id, i) => {
        plan[id] = Array.from({ length: rounds }, (_, round) => startServerMs + (round * n + i) * SLOT_MS)
    })
    return plan
}

/** When the last click's window closes (server ms). */
export function planEndMs(plan: Record<string, number[]>): number {
    return Math.max(...Object.values(plan).flat()) + WINDOW_AFTER_MS
}

/** Roughly how long a calibration of `devices` takes, for telling the user (whole 5 s). */
export function calibrationSeconds(devices: number): number {
    const ms = PREP_MS + ROUNDS * devices * SLOT_MS
    return Math.ceil(ms / 5000) * 5
}

export interface Recording {
    samples: Float32Array
    sampleRate: number
    /** Server time of `samples[0]` — up to a constant, which cancels out. */
    startServerMs: number
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** The median of the values that agree with the majority, or null without two of them. */
export function agreeing(values: (number | null)[]): number | null {
    const heard = values.filter((v): v is number => v !== null)
    if (heard.length < 2) return null
    const mid = median(heard)
    const close = heard.filter(v => Math.abs(v - mid) <= AGREE_MS)
    return close.length >= 2 ? median(close) : null
}

const templates = new Map<number, Float32Array>()

function templateFor(sampleRate: number): Float32Array {
    let template = templates.get(sampleRate)
    if (!template) {
        template = chirp(sampleRate)
        templates.set(sampleRate, template)
    }
    return template
}

export interface ClickMeasurement {
    /** Arrival behind the reported sound time, per click (ms); null where nothing clear was heard. */
    offsetsMs: (number | null)[]
    /** How clearly each click stood out (see `findArrival`); null where its window was not recorded. */
    strengths: (number | null)[]
}

/**
 * Where in `recording` one device's clicks arrived, relative to when it says
 * they sounded. A click's offset is null where nothing clear was heard, or
 * where its window is not in the recording.
 */
export function measureClicks(recording: Recording, soundedMs: (number | null)[]): ClickMeasurement {
    const { samples, sampleRate } = recording
    const template = templateFor(sampleRate)
    const before = Math.round((WINDOW_BEFORE_MS * sampleRate) / 1000)
    const after = Math.round((WINDOW_AFTER_MS * sampleRate) / 1000)

    const clicks = soundedMs.map(sounded => {
        if (sounded === null || !Number.isFinite(sounded)) return { offset: null, strength: null }
        const center = Math.round(((sounded - recording.startServerMs) * sampleRate) / 1000)
        const from = center - before
        const to = center + after + template.length
        if (from < 0 || to > samples.length) return { offset: null, strength: null }

        const envelope = correlationEnvelope(samples.subarray(from, to), template, sampleRate, CHIRP_BAND_HZ)
        const arrival = findArrival(envelope, sampleRate, before + after)
        if (!arrival) return { offset: null, strength: null }
        const arrivedMs = recording.startServerMs + ((from + arrival.index) / sampleRate) * 1000
        return { offset: arrival.strength < MIN_STRENGTH ? null : arrivedMs - sounded, strength: arrival.strength }
    })
    return { offsetsMs: clicks.map(c => c.offset), strengths: clicks.map(c => c.strength) }
}

/**
 * How much later each device sounds than the reference (ms), from the
 * per-click offsets of `measureClicks`, keyed like the input. Devices without
 * two agreeing rounds are left out.
 *
 * Each click is compared with the reference's click OF THE SAME ROUND, a
 * second or two apart — not the whole recording at once. A recording can
 * lose a stretch of samples under load, which shifts everything after it;
 * compared round by round, such a hiccup spoils at most the round it falls
 * in. The reference is the device heard most often (usually the listener
 * itself, right next to its microphone).
 */
export function relativeLatencies(offsets: Record<string, (number | null)[]>): Record<string, number> {
    const ids = Object.keys(offsets)
    const heard = (id: string) => offsets[id].filter(v => v !== null).length
    const reference = ids.reduce<string | null>((best, id) => (best === null || heard(id) > heard(best) ? id : best), null)
    if (reference === null || heard(reference) < 2) return {}

    const result: Record<string, number> = { [reference]: 0 }
    for (const id of ids) {
        if (id === reference) continue
        const pairs = offsets[id].map((ms, round) => {
            const ref = offsets[reference][round]
            return ms === null || ref === null || ref === undefined ? null : ms - ref
        })
        const latency = agreeing(pairs)
        if (latency !== null) result[id] = latency
    }
    return result
}

/**
 * How fast a device's delay moved while it clicked (ms per second): the median
 * of the slopes between consecutive clicks it was heard with. A median, because
 * one stray click spoils two neighbouring slopes in opposite directions, and a
 * stretch of samples lost in the recording shifts every later click by the
 * same amount — one slope jumps, the others stay flat. Null with fewer than
 * three such clicks.
 */
export function driftMsPerS(offsetsMs: (number | null)[], soundedMs: (number | null)[]): number | null {
    const heard: { at: number; ms: number }[] = []
    offsetsMs.forEach((ms, k) => {
        const at = soundedMs[k]
        if (ms !== null && at !== null && at !== undefined && Number.isFinite(at)) heard.push({ at, ms })
    })
    if (heard.length < 3) return null
    const slopes = heard.slice(1).map((click, i) => ((click.ms - heard[i].ms) / (click.at - heard[i].at)) * 1000)
    return median(slopes)
}

/**
 * The devices whose delay was still moving while they clicked — no trim can be
 * read off those. After a pause, a Windows → Bluetooth path starts ~150 ms
 * short of the delay it has under music and climbs ~3 ms a second (measured
 * 2026-09-27); a trim taken then is wrong by whatever it still has to climb.
 *
 * Movement that every device shares is the listener's own clock, not theirs:
 * each device is judged against the steadiest one. A device that is the only
 * one to judge has nothing to share a movement with — it is judged against
 * standing still, or it would be its own reference and never settle.
 */
export function settlingDevices(
    offsets: Record<string, (number | null)[]>,
    soundedMs: Record<string, (number | null)[]>
): string[] {
    const drifts = Object.keys(offsets)
        .map(id => ({ id, drift: driftMsPerS(offsets[id], soundedMs[id] ?? []) }))
        .filter((d): d is { id: string; drift: number } => d.drift !== null)
    if (drifts.length === 0) return []
    const steadiest =
        drifts.length === 1
            ? 0
            : drifts.reduce((best, d) => (Math.abs(d.drift) < Math.abs(best.drift) ? d : best)).drift
    return drifts.filter(d => Math.abs(d.drift - steadiest) > SETTLING_MS_PER_S).map(d => d.id)
}

/**
 * Trims from relative latencies: the device heard earliest is the reference
 * and keeps 0, every later one starts that much earlier. Anchoring on the
 * earliest rather than on the listener keeps the group on the server's
 * timeline — the delay the browser misses only ever adds — so a device that
 * joins later with a correctly reported output fits without a trim.
 */
export function suggestTrims(latencies: Record<string, number>): Record<string, number> {
    const values = Object.values(latencies)
    if (values.length < 2) return {}
    const reference = Math.min(...values)
    return Object.fromEntries(Object.entries(latencies).map(([id, ms]) => [id, clampOffset(ms - reference)]))
}
