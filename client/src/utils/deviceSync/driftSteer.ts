// Drift-steering policy: given where a device's audio currently is versus
// where it should be, decide how to converge. Small errors are absorbed by a
// gentle playbackRate nudge (pitch-preserving); large errors need a hard seek.
// Pure function — the store applies the returned action to the audio element.

/** Errors under this (ms) are ignored to avoid audible micro-corrections. */
// 25 ms, not 50: a 50 ms offset between two speakers in one room is audible
// as an echo/comb filter, so the steering has to keep pulling below that.
export const DEADBAND_MS = 25

/** Errors above this (ms) are too large to steer out — seek instead. */
export const HARD_MS = 1000

/** Maximum playbackRate deviation from 1.0 (±4%). */
export const MAX_RATE_DELTA = 0.04

/** Proportional gain mapping the error (as a fraction of a second) to a rate delta. */
export const GAIN = 0.5

export type Correction =
    | { action: 'none' }
    | { action: 'rate'; rate: number }
    | { action: 'seek'; seekToMs: number }

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/**
 * Decide the correction for a device whose audio is at `currentTimeMs` while
 * the expected position is `expectedMs`.
 *
 * error > 0 means the device is AHEAD → rate < 1 (slow down);
 * error < 0 means the device is BEHIND → rate > 1 (speed up).
 */
export function computeCorrection(currentTimeMs: number, expectedMs: number): Correction {
    const error = currentTimeMs - expectedMs
    const absError = Math.abs(error)

    if (absError < DEADBAND_MS) {
        return { action: 'none' }
    }

    if (absError <= HARD_MS) {
        const delta = clamp((error / 1000) * GAIN, -MAX_RATE_DELTA, MAX_RATE_DELTA)
        return { action: 'rate', rate: 1 - delta }
    }

    return { action: 'seek', seekToMs: expectedMs }
}
