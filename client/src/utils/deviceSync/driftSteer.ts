// Drift-steering policy: given how far a device's audio is from where the
// group anchor says it should be, decide how to converge. Small errors are
// absorbed by a playbackRate nudge (pitch-preserving); large errors need a
// seek. Pure function — the store applies the returned action to the audio
// element and remembers the one bit of state the hysteresis needs.
//
// The numbers come from measuring what a rate change actually buys
// (~/syncprobe/ratebench.js on the server, headless Chromium and Firefox):
// in Chromium, leaving rate 1.0 costs ~20-30 ms of media time up front and
// returning to it ~10 ms more — the time-stretcher has to prime. At 4 % the
// clock then gains ~40 ms/s; at 1 % it gained 14 ms in FOUR seconds, net.
// A small rate on a small error is therefore worse than nothing.

/** Steering engages once the error exceeds this (ms)... */
// Below this a steering cycle costs about as much as it corrects.
export const ENGAGE_MS = 25

/** ...and, once engaged, keeps going until the error is back under this (ms). */
// Hysteresis: releasing at the engage threshold parks every device at the
// edge of the band, and each extra cycle pays the priming cost again.
export const RELEASE_MS = 8

/** Errors above this (ms) are seeked instead of steered. */
// A seek is compensated for this device's own seek latency (latency.ts) and
// lands within a few ms; steering 100 ms out takes three seconds of audible
// echo. The old threshold of 1000 ms meant up to 25 s of it.
export const SEEK_MS = 100

/** Rate deviation while steering: never below MIN (it would not pay), never above MAX. */
export const MIN_RATE_DELTA = 0.02
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

    const delta = clamp((absError / 1000) * GAIN, MIN_RATE_DELTA, MAX_RATE_DELTA)
    return { action: 'rate', rate: errorMs > 0 ? 1 - delta : 1 + delta }
}
