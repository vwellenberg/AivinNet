// The calibration click, and the audio files that carry it.
//
// A click is a short linear chirp rather than a tone burst: its correlation
// peak is only about 1 / bandwidth wide (~0.2 ms here), so the listening
// device can place it to a fraction of a millisecond even in a room full of
// reflections (see clickDetect.ts).
//
// The files are played through an ordinary <audio> element — the path the
// music takes — so whatever the operating system hides from the browser
// (Windows does not report Bluetooth latency) is in the click as well.

export const CHIRP_MS = 20
export const CHIRP_F0_HZ = 1000
export const CHIRP_F1_HZ = 6000
/** The band the detector listens in: the chirp plus a margin. */
export const CHIRP_BAND_HZ: [number, number] = [800, 6500]

/** The sample a click at `ms` starts on — the one rounding shared by the file and the report. */
export function clickSample(ms: number, sampleRate: number): number {
    return Math.round((ms * sampleRate) / 1000)
}

/** Where a click at `ms` really starts in a file at `sampleRate` (ms). */
export function clickStartMs(ms: number, sampleRate: number): number {
    return (clickSample(ms, sampleRate) / sampleRate) * 1000
}

/** The chirp at `sampleRate`, Hann-windowed, with the given peak amplitude. */
export function chirp(sampleRate: number, amplitude = 1): Float32Array {
    const n = Math.round((CHIRP_MS / 1000) * sampleRate)
    const out = new Float32Array(n)
    const duration = n / sampleRate
    const sweep = (CHIRP_F1_HZ - CHIRP_F0_HZ) / duration
    for (let i = 0; i < n; i++) {
        const t = i / sampleRate
        const phase = 2 * Math.PI * (CHIRP_F0_HZ * t + 0.5 * sweep * t * t)
        const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))
        out[i] = amplitude * window * Math.sin(phase)
    }
    return out
}

export interface ClickTrack {
    sampleRate: number
    durationMs: number
    /** Where each click starts, in ms from the start of the file. */
    clicksMs: number[]
    /** Peak amplitude of a click, 0..1 (before the device volume). */
    amplitude: number
}

/** A mono 16-bit PCM WAV of silence carrying the chirp at each of `clicksMs`. */
export function clickWav(track: ClickTrack): ArrayBuffer {
    const { sampleRate } = track
    const frames = Math.ceil((track.durationMs * sampleRate) / 1000)
    const buffer = new ArrayBuffer(44 + frames * 2)
    const view = new DataView(buffer)

    const ascii = (at: number, text: string) => {
        for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i))
    }
    ascii(0, 'RIFF')
    view.setUint32(4, 36 + frames * 2, true)
    ascii(8, 'WAVE')
    ascii(12, 'fmt ')
    view.setUint32(16, 16, true) // fmt chunk size
    view.setUint16(20, 1, true) // PCM
    view.setUint16(22, 1, true) // mono
    view.setUint32(24, sampleRate, true)
    view.setUint32(28, sampleRate * 2, true) // byte rate
    view.setUint16(32, 2, true) // block align
    view.setUint16(34, 16, true) // bits per sample
    ascii(36, 'data')
    view.setUint32(40, frames * 2, true)

    const click = chirp(sampleRate, track.amplitude)
    for (const ms of track.clicksMs) {
        const start = clickSample(ms, sampleRate)
        for (let i = 0; i < click.length && start + i < frames; i++) {
            if (start + i < 0) continue
            const value = Math.max(-1, Math.min(1, click[i]))
            view.setInt16(44 + (start + i) * 2, Math.round(value * 32767), true)
        }
    }
    return buffer
}
