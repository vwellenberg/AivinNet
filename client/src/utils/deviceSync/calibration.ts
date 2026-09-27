// Sync calibration, the arithmetic: who clicks when, where to look for each
// click in the recording, and what trims follow from what was heard.
//
// Every device reports when each of its clicks left the speaker by its OWN
// media clock (the clock the group steering aligns). The listening device
// hears when it really arrived. The difference is what the browser cannot
// see — Bluetooth on Windows, a soundbar's DSP — plus a constant shared by
// every device (microphone latency, sound travel to the listener). Only the
// differences between devices count, so that constant drops out.

import { chirp, CHIRP_BAND_HZ } from './clickSignal'
import { clampOffset } from './audioOffset'
import { correlationEnvelope, findArrival } from './clickDetect'

/** Time between two clicks in the plan (ms): one device at a time, the room quiet again in between. */
export const SLOT_MS = 1200
/** Clicks per device; a result needs two that agree. */
export const ROUNDS = 3
/** From the start to the first click (ms): the pause has to land and every device has to hear of the plan. */
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
/** Clicks of one device agree when they lie this close (ms). */
export const AGREE_MS = 4

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

export interface Recording {
    samples: Float32Array
    sampleRate: number
    /** Server time of `samples[0]` — up to a constant, which cancels out. */
    startServerMs: number
}

export interface Measurement {
    /** Arrival minus reported sound time per click (ms); null where nothing clear was heard. */
    offsetsMs: (number | null)[]
    /** The median of the clicks that agree, or null unless at least two do. */
    latencyMs: number | null
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

/**
 * Where in `recording` one device's clicks arrived, relative to when it says
 * they sounded. A click whose window is not (yet) fully recorded is null.
 */
export function measureClicks(recording: Recording, soundedMs: (number | null)[]): Measurement {
    const { samples, sampleRate } = recording
    const template = templateFor(sampleRate)
    const before = Math.round((WINDOW_BEFORE_MS * sampleRate) / 1000)
    const after = Math.round((WINDOW_AFTER_MS * sampleRate) / 1000)

    const offsetsMs = soundedMs.map(sounded => {
        if (sounded === null || !Number.isFinite(sounded)) return null
        const center = Math.round(((sounded - recording.startServerMs) * sampleRate) / 1000)
        const from = center - before
        const to = center + after + template.length
        if (from < 0 || to > samples.length) return null

        const envelope = correlationEnvelope(samples.subarray(from, to), template, sampleRate, CHIRP_BAND_HZ)
        const arrival = findArrival(envelope, sampleRate, before + after)
        if (!arrival || arrival.strength < MIN_STRENGTH) return null
        const arrivedMs = recording.startServerMs + ((from + arrival.index) / sampleRate) * 1000
        return arrivedMs - sounded
    })
    return { offsetsMs, latencyMs: agreeing(offsetsMs) }
}

/**
 * Trims from measured latencies: the device heard earliest is the reference
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
