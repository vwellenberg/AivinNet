// Test helpers: a synthetic room recording of calibration clicks.

import { chirp } from '@/utils/deviceSync/clickSignal'

/** Deterministic PRNG (mulberry32) — the same noise on every run. */
export function prng(seed: number): () => number {
    let a = seed >>> 0
    return () => {
        a = (a + 0x6d2b79f5) >>> 0
        let t = a
        t = Math.imul(t ^ (t >>> 15), t | 1)
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

export function gaussian(rand: () => number): number {
    const u = Math.max(rand(), 1e-12)
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand())
}

export interface Arrival {
    /** Server time the click's direct sound reaches the microphone. */
    atMs: number
    /** Amplitude (negative: a speaker wired the other way round). */
    gain: number
}

/**
 * A recording starting at `startServerMs`: white noise, every arrival as the
 * chirp plus three wall reflections, the first of them as loud as the
 * direct sound's echo off a nearby wall can get.
 */
export function roomRecording(opts: {
    sampleRate: number
    startServerMs: number
    durationMs: number
    arrivals: Arrival[]
    noise: number
    seed?: number
}): Float32Array {
    const { sampleRate } = opts
    const samples = new Float32Array(Math.round((opts.durationMs * sampleRate) / 1000))
    const rand = prng(opts.seed ?? 7)
    for (let i = 0; i < samples.length; i++) samples[i] = opts.noise * gaussian(rand)

    const click = chirp(sampleRate)
    const reflections = [
        { delayMs: 0, gain: 1 },
        { delayMs: 4.3, gain: 0.8 },
        { delayMs: 11, gain: 0.45 },
        { delayMs: 23, gain: 0.25 },
    ]
    for (const arrival of opts.arrivals) {
        for (const r of reflections) {
            const start = Math.round(((arrival.atMs + r.delayMs - opts.startServerMs) * sampleRate) / 1000)
            for (let i = 0; i < click.length; i++) {
                const at = start + i
                if (at >= 0 && at < samples.length) samples[at] += arrival.gain * r.gain * click[i]
            }
        }
    }
    return samples
}
