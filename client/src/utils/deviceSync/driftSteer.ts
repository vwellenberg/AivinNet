// Drift-steering policy: given how far a device's audio is from where the
// group anchor says it should be, decide how to converge. Small errors are
// absorbed by a gentle playbackRate nudge (pitch-preserving); large errors need
// a seek. Pure function — the store applies the returned action to the audio
// element and remembers the one bit of state the hysteresis needs.

/** Steering engages once the error exceeds this (ms). */
// 20 ms: two speakers in one room 40-50 ms apart comb-filter audibly, and two
// devices can sit on opposite sides of the anchor.
export const ENGAGE_MS = 20

/** ...and, once engaged, keeps going until the error is back under this (ms). */
// Hysteresis. Releasing at the same threshold it engaged at parked every
// device at the edge of the band — up to twice the band apart from the next
// one, indefinitely.
export const RELEASE_MS = 8

/** Errors above this (ms) are seeked instead of steered. */
// A seek is compensated for this device's own seek latency (latency.ts) and
// lands within a few ms; easing 150 ms out at 4 % would take four seconds of
// audible echo. The old 1000 ms threshold meant up to 25 s of it.
export const SEEK_MS = 150

/** Maximum playbackRate deviation from 1.0 (±4%). */
export const MAX_RATE_DELTA = 0.04

/** Proportional gain mapping the error (as a fraction of a second) to a rate delta. */
export const GAIN = 0.5

export type Correction = { action: 'none' } | { action: 'rate'; rate: number } | { action: 'seek' }

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/**
 * Decide the correction for an error of `errorMs` (device position minus
 * expected position). `steering` is whether rate steering is engaged right
 * now — it moves the threshold from ENGAGE_MS down to RELEASE_MS.
 *
 * error > 0 means the device is AHEAD → rate < 1 (slow down);
 * error < 0 means the device is BEHIND → rate > 1 (speed up).
 */
export function computeCorrection(errorMs: number, steering: boolean): Correction {
    const absError = Math.abs(errorMs)

    if (absError > SEEK_MS) {
        return { action: 'seek' }
    }

    if (absError < (steering ? RELEASE_MS : ENGAGE_MS)) {
        return { action: 'none' }
    }

    const delta = clamp((errorMs / 1000) * GAIN, -MAX_RATE_DELTA, MAX_RATE_DELTA)
    return { action: 'rate', rate: 1 - delta }
}
