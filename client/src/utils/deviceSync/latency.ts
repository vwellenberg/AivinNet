// Per-device latency model for group playback — learned, not configured.
//
// The group anchor says where playback IS. Whether this device is audibly
// there depends on two delays the clock protocol cannot see, and both are
// facts about this browser and this output, not about the group:
//
//  - start: play() on a ready element → its clock starts moving
//  - seek:  a seek on a PLAYING element → its clock moves again
//           (renderer flush, decoder preroll, output buffer refill)
//
// `currentTime` stands still for exactly that long, then runs on — so the
// device ends up behind by the delay. Measured on headless Chromium, a seek
// cost ~90 ms, and a steerer that re-seeked every 250 ms whenever it was more
// than 80 ms off seeked ten times in a row after every transition.
//
// Both delays are compensated in advance (play() that much early, seek that
// much ahead) and re-estimated after every action from the residual error once
// playback has settled, so each device converges on its own numbers within a
// transition or two. Browsers already fold the output latency they know about
// into `currentTime`; what they do not know (a soundbar's DSP, some Bluetooth
// stacks) is what the manual trim in audioOffset.ts is still for.

export type LatencyKind = 'start' | 'seek'
export type LatencyModel = Record<LatencyKind, number>

const KEY = 'aivinnet.sync_latency'

/** Starting point before a device has measured itself. */
export const DEFAULT_LATENCY: LatencyModel = { start: 30, seek: 90 }

/** Upper bound for either estimate (ms). */
export const MAX_LATENCY_MS = 600

/**
 * A residual beyond this (ms) is a stall — buffering, a throttled tab — not a
 * latency, and is never learned from.
 */
export const MAX_RESIDUAL_MS = 300

/** Share of each residual folded into the estimate. */
export const LEARN_RATE = 0.6

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/**
 * Update an estimate from the residual error (device position minus expected
 * position, ms) measured once the action settled. Behind (negative residual)
 * means the delay was underestimated.
 */
export function learnLatency(current: number, residualMs: number): number {
    if (!Number.isFinite(residualMs) || Math.abs(residualMs) > MAX_RESIDUAL_MS) return current
    return clamp(Math.round(current - residualMs * LEARN_RATE), 0, MAX_LATENCY_MS)
}

export function loadLatency(): LatencyModel {
    try {
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
        const read = (kind: LatencyKind) =>
            Number.isFinite(raw?.[kind]) ? clamp(Math.round(raw[kind]), 0, MAX_LATENCY_MS) : DEFAULT_LATENCY[kind]
        return { start: read('start'), seek: read('seek') }
    } catch {
        return { ...DEFAULT_LATENCY }
    }
}

export function saveLatency(model: LatencyModel) {
    try {
        localStorage.setItem(KEY, JSON.stringify(model))
    } catch {
        // storage unavailable (private mode) — the estimate lives for this session only
    }
}
