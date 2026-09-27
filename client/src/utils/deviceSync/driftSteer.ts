// Drift-steering policy: given how far a device's audio is from where the
// group anchor says it should be, decide how to converge. Pure function — the
// store applies the result to the audio element.
//
// Steering RESAMPLES (player.ts `setFineSteering`: preservesPitch off), which
// Chromium keeps running at every rate, 1.0 included. That makes a correction
// free to start and stop, so the rate simply follows the error continuously:
// no engage threshold, no hysteresis. The previous policy steered with the
// pitch-preserving time-stretcher, whose restart cost 20-30 ms per episode —
// it had to tolerate 25 ms per device, and two devices 20 ms apart are
// audible (reported, and plausible: a comb filter in one room).

/** Errors under this (ms) are left alone: the rate returns to exactly 1.0. */
export const DEADBAND_MS = 2

/** Rate change per second of error: 10 ms off → 0.5 %, converging in ~2 s. */
export const GAIN = 0.5

/**
 * Largest rate deviation (±0.5 %). Resampling moves the pitch with it; half a
 * percent is 8.6 cents, below what one hears in music for a few seconds.
 */
export const MAX_RATE_DELTA = 0.005

/**
 * Errors above this (ms) are seeked instead: at 0.5 % a 40 ms offset would
 * take eight seconds. A seek is compensated for this device's own seek
 * latency (latency.ts) and lands within a few ms.
 */
export const SEEK_MS = 40

export type Correction = { action: 'rate'; rate: number } | { action: 'seek' }

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value))
}

/**
 * Decide the correction for an error of `errorMs` (device position minus
 * expected position). Returns the rate to run at — 1.0 inside the deadband —
 * or a seek.
 *
 * error > 0 means the device is AHEAD → rate < 1 (slow down);
 * error < 0 means the device is BEHIND → rate > 1 (speed up).
 */
export function computeCorrection(errorMs: number): Correction {
    const absError = Math.abs(errorMs)

    if (absError > SEEK_MS) {
        return { action: 'seek' }
    }

    if (absError < DEADBAND_MS) {
        return { action: 'rate', rate: 1 }
    }

    const delta = clamp((errorMs / 1000) * GAIN, -MAX_RATE_DELTA, MAX_RATE_DELTA)
    return { action: 'rate', rate: 1 - delta }
}
