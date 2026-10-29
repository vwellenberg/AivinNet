/**
 * The static between stations (#542). Made here with Web Audio, not shipped as
 * a file: a short, quiet burst of band-limited noise.
 */

export const STATIC_MS = 300
/** Quiet on purpose: this is a texture under the dial, not a sound effect. */
export const STATIC_GAIN = 0.05
/** Bursts closer together than this would stack into a wall of noise. */
const BURST_GAP_MS = 250

/**
 * `length` samples of white noise in [-1, 1], faded in over a few milliseconds
 * and out over the last fifth, so the burst never clicks at either end.
 */
export function staticSamples(length: number, random: () => number = Math.random): Float32Array {
    const out = new Float32Array(Math.max(0, length))
    const attack = Math.max(1, Math.floor(length * 0.02))
    const release = Math.max(1, Math.floor(length * 0.2))

    for (let i = 0; i < out.length; i++) {
        const envelope = Math.min(1, (i + 1) / attack, (out.length - i) / release)
        out[i] = (random() * 2 - 1) * envelope
    }

    return out
}

type AudioContextCtor = new () => AudioContext

let context: AudioContext | undefined
let lastBurst = -Infinity

/**
 * Play one static burst. Returns false when nothing played: no Web Audio here,
 * a burst was just played, or the browser refused the context. Never throws,
 * because a missing hiss must not stop the station from starting.
 */
export function playStatic(now: number = Date.now()): boolean {
    if (now - lastBurst < BURST_GAP_MS) return false

    try {
        const Ctor: AudioContextCtor | undefined =
            typeof window === 'undefined' ? undefined : (window.AudioContext ?? (window as any).webkitAudioContext)
        if (!Ctor) return false

        if (!context) context = new Ctor()
        const ctx = context
        const buffer = ctx.createBuffer(1, Math.round((ctx.sampleRate * STATIC_MS) / 1000), ctx.sampleRate)
        buffer.copyToChannel(staticSamples(buffer.length), 0)

        const source = ctx.createBufferSource()
        source.buffer = buffer

        const band = ctx.createBiquadFilter()
        band.type = 'bandpass'
        band.frequency.value = 1800
        band.Q.value = 0.7

        const gain = ctx.createGain()
        gain.gain.value = STATIC_GAIN

        source.connect(band).connect(gain).connect(ctx.destination)
        void ctx.resume?.()
        source.start()
        lastBurst = now
        return true
    } catch {
        return false
    }
}
