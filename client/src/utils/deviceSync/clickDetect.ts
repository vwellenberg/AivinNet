// Finding a known click in a microphone recording.
//
// A matched filter: the recording correlated with the click, limited to the
// click's own band and taken as an envelope (analytic signal), so the peak
// does not depend on which way round a speaker is wired. The room shows up as
// what it is — the direct sound first, then its reflections off walls and
// furniture, each at its true strength. That is why this is NOT GCC-PHAT, the
// method that measured the first 155 ms with music as the signal
// (~/syncprobe/acoustic_measure.py): PHAT flattens every frequency to the
// same weight, which a song needs and a chirp does not, and it squeezes a
// weaker path — so a direct sound partly blocked by furniture vanished behind
// its own reflection, several milliseconds late.

/** In-place iterative radix-2 FFT of (re, im); the length must be a power of two. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
    const n = re.length
    for (let i = 1, j = 0; i < n; i++) {
        let bit = n >> 1
        for (; j & bit; bit >>= 1) j ^= bit
        j ^= bit
        if (i < j) {
            let t = re[i]
            re[i] = re[j]
            re[j] = t
            t = im[i]
            im[i] = im[j]
            im[j] = t
        }
    }
    for (let len = 2; len <= n; len <<= 1) {
        const half = len >> 1
        const angle = ((inverse ? 2 : -2) * Math.PI) / len
        for (let k = 0; k < half; k++) {
            // Twiddles computed directly: a running product drifts at 64k points.
            const wRe = Math.cos(angle * k)
            const wIm = Math.sin(angle * k)
            for (let i = k; i < n; i += len) {
                const j = i + half
                const bRe = re[j] * wRe - im[j] * wIm
                const bIm = re[j] * wIm + im[j] * wRe
                re[j] = re[i] - bRe
                im[j] = im[i] - bIm
                re[i] += bRe
                im[i] += bIm
            }
        }
    }
    if (inverse) {
        for (let i = 0; i < n; i++) {
            re[i] /= n
            im[i] /= n
        }
    }
}

function nextPow2(n: number): number {
    let p = 1
    while (p < n) p <<= 1
    return p
}

/**
 * How strongly `template` starts at each sample of `signal`: the correlation
 * envelope, band-limited to `bandHz`. Index i = the template starting at
 * signal[i].
 */
export function correlationEnvelope(
    signal: Float32Array,
    template: Float32Array,
    sampleRate: number,
    bandHz: [number, number]
): Float64Array {
    const n = nextPow2(signal.length + template.length)
    const sRe = new Float64Array(n)
    const sIm = new Float64Array(n)
    const tRe = new Float64Array(n)
    const tIm = new Float64Array(n)
    sRe.set(signal)
    tRe.set(template)
    fft(sRe, sIm)
    fft(tRe, tIm)

    // S · conj(T), the band's positive frequencies doubled and everything else
    // zero: the inverse is the analytic correlation.
    const gRe = new Float64Array(n)
    const gIm = new Float64Array(n)
    const lo = Math.max(1, Math.ceil((bandHz[0] * n) / sampleRate))
    const hi = Math.min(n / 2 - 1, Math.floor((bandHz[1] * n) / sampleRate))
    for (let k = lo; k <= hi; k++) {
        gRe[k] = 2 * (sRe[k] * tRe[k] + sIm[k] * tIm[k])
        gIm[k] = 2 * (sIm[k] * tRe[k] - sRe[k] * tIm[k])
    }
    fft(gRe, gIm, true)

    const out = new Float64Array(signal.length)
    for (let i = 0; i < signal.length; i++) out[i] = Math.hypot(gRe[i], gIm[i])
    return out
}

export interface Arrival {
    /** Sample index at which the click starts. */
    index: number
    /** Peak over the envelope's RMS elsewhere: how clearly it stands out (noise alone stays near 3). */
    strength: number
}

/** A reflection can be louder than the direct sound, but never earlier: look back this far (ms). */
const DIRECT_LOOKBACK_MS = 15
/** An earlier peak at this share of the loudest one counts as the direct sound. */
const DIRECT_SHARE = 0.5
/** The peak's own width, left out of the noise estimate (ms). */
const PEAK_GUARD_MS = 2

/** The direct sound among the envelope's peaks up to `lastIndex`, or null for an empty range. */
export function findArrival(envelope: Float64Array, sampleRate: number, lastIndex: number): Arrival | null {
    const end = Math.min(lastIndex, envelope.length - 2)
    if (end < 2) return null

    let peak = 1
    for (let i = 2; i <= end; i++) if (envelope[i] > envelope[peak]) peak = i

    const guard = Math.round((PEAK_GUARD_MS / 1000) * sampleRate)
    let sum = 0
    let count = 0
    for (let i = 0; i <= end; i++) {
        if (Math.abs(i - peak) <= guard) continue
        sum += envelope[i] * envelope[i]
        count++
    }
    const rms = Math.sqrt(sum / Math.max(1, count))
    const strength = rms > 0 ? envelope[peak] / rms : Infinity

    let first = peak
    const from = Math.max(1, peak - Math.round((DIRECT_LOOKBACK_MS / 1000) * sampleRate))
    for (let i = from; i < peak; i++) {
        const isPeak = envelope[i] >= envelope[i - 1] && envelope[i] >= envelope[i + 1]
        if (isPeak && envelope[i] >= DIRECT_SHARE * envelope[peak]) {
            first = i
            break
        }
    }
    return { index: first, strength }
}
