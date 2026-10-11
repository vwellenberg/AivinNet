// ---------------------------------------------------------------------------
// The levels of the music that is playing, for the equaliser (PlayingMeter).
//
// A media element can hand out a copy of its output (`captureStream`). The copy
// goes into an analyser, and the element keeps its own audible path. That is
// the point: `createMediaElementSource` would REROUTE the element through Web
// Audio, and the group sync calibration measures the path the music takes
// through the element (device-sync.md: "Klicks durch ein <audio>, nie Web
// Audio"). The analyser's output is silent (gain 0), so nothing is added to
// the sound.
//
// The loop runs only while a meter is listening, and only where the browser can
// capture the element. Everywhere else nobody gets a level, and the meters keep
// their own animation. Under "less motion" nothing is listened to at all.
// ---------------------------------------------------------------------------

export type LevelListener = (levels: number[] | null) => void

type CapturingElement = HTMLMediaElement & { captureStream?: () => MediaStream }

/** The four bars of the equaliser, low to high. */
export const METER_BANDS = 4
/** Band edges in Hz: 60–250, 250–1k, 1k–4k, 4k–12k. */
const BAND_HZ = [60, 250, 1000, 4000, 12000]
const FFT_SIZE = 1024
/** About 30 readings a second is plenty for four bars. */
const FRAME_MS = 33
/** A failed capture is not tried again more often than this. */
const RETRY_MS = 1000
/** Per reading: a peak keeps 99.5% of its height, about half after five seconds. */
const PEAK_DECAY = 0.995
const PEAK_FLOOR = 0.2

let provider: () => HTMLMediaElement | null = () => null
const listeners = new Set<LevelListener>()
let frame = 0
let lastFrame = 0
let silent = false

let context: AudioContext | null = null
let analyser: AnalyserNode | null = null
let source: MediaStreamAudioSourceNode | null = null
let stream: MediaStream | null = null
let attached: HTMLMediaElement | null = null
let failed: HTMLMediaElement | null = null
let failedAt = 0
let edges: number[] = []
let bins = new Uint8Array(0)
let peaks: number[] = [0, 0, 0, 0]

/** The store says which element is playing right now (player.ts). */
export function setLevelProvider(fn: () => HTMLMediaElement | null) {
    provider = fn
}

export function levelsSupported(): boolean {
    return (
        typeof AudioContext === 'function' &&
        typeof (HTMLMediaElement.prototype as CapturingElement).captureStream === 'function'
    )
}

function prefersLessMotion(): boolean {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** The mean of each band, 0 (silent) to 1 (full scale). `edges` are bin indices, one more than the bands. */
export function bandLevels(data: Uint8Array, bandEdges: number[]): number[] {
    const out: number[] = []
    for (let band = 0; band + 1 < bandEdges.length; band++) {
        const from = bandEdges[band]
        const to = bandEdges[band + 1]
        let sum = 0
        for (let bin = from; bin < to; bin++) sum += data[bin] ?? 0
        out.push(to > from ? sum / (to - from) / 255 : 0)
    }
    return out
}

/** The analyser bin under each band edge, for a given sample rate and FFT size. */
export function binEdges(sampleRate: number, fftSize: number, hz: number[] = BAND_HZ): number[] {
    const bins = fftSize / 2
    return hz.map(frequency => Math.min(bins, Math.round((frequency * fftSize) / sampleRate)))
}

/**
 * Each band is scaled against its own recent peak, so the bars use the full
 * height whatever the track's loudness is. The peak falls back slowly (about
 * five seconds to half), and never below `PEAK_FLOOR`, so near-silence stays low.
 * `peaks` is the running state, one entry per band; it is updated in place.
 */
export function normalizeLevels(raw: number[], peaks: number[]): number[] {
    return raw.map((value, band) => {
        peaks[band] = Math.max(value, (peaks[band] ?? 0) * PEAK_DECAY)
        return Math.min(1, value / Math.max(peaks[band], PEAK_FLOOR))
    })
}

/** The LED grid of the meter: quarter steps, and never less than one lit segment. */
export function quantizeLevel(value: number): number {
    return Math.min(1, Math.max(0.25, Math.round(value * 4) / 4))
}

function detach() {
    source?.disconnect()
    analyser?.disconnect()
    stream?.getTracks().forEach(track => track.stop())
    source = null
    analyser = null
    stream = null
    attached = null
    bins = new Uint8Array(0)
    peaks = peaks.map(() => 0)
}

/** Taps `el` into the analyser. False if the browser cannot, or the attempt just failed. */
function attach(el: HTMLMediaElement, now: number): boolean {
    if (el === attached) return true
    if (el === failed && now - failedAt < RETRY_MS) return false
    detach()
    try {
        const capturable = el as CapturingElement
        if (typeof capturable.captureStream !== 'function') throw new Error('captureStream unavailable')

        context ??= new AudioContext()
        stream = capturable.captureStream()
        source = context.createMediaStreamSource(stream)
        analyser = context.createAnalyser()
        analyser.fftSize = FFT_SIZE
        analyser.smoothingTimeConstant = 0.7
        analyser.minDecibels = -90
        analyser.maxDecibels = -20

        // The analyser only runs while it reaches the output. A silent gain
        // carries it there without adding anything to the sound.
        const mute = context.createGain()
        mute.gain.value = 0
        source.connect(analyser)
        analyser.connect(mute)
        mute.connect(context.destination)

        bins = new Uint8Array(analyser.frequencyBinCount)
        edges = binEdges(context.sampleRate, FFT_SIZE)
        attached = el
        failed = null
        void context.resume().catch(() => {})
        return true
    } catch {
        detach()
        failed = el
        failedAt = now
        return false
    }
}

function emit(levels: number[] | null) {
    for (const listener of listeners) listener(levels)
}

function tick(now: number) {
    frame = 0
    if (!listeners.size) return
    frame = requestAnimationFrame(tick)
    if (now - lastFrame < FRAME_MS) return
    lastFrame = now

    const el = provider()
    const playing = !!el && !el.paused && !el.ended
    if (!el || !playing || !attach(el, now) || !analyser) {
        if (!silent) emit(null)
        silent = true
        return
    }
    silent = false
    analyser.getByteFrequencyData(bins)
    emit(normalizeLevels(bandLevels(bins, edges), peaks))
}

/**
 * A meter asks for the levels of the music. Returns the call that stops asking.
 * Where nothing can be measured, the listener is never called and the meter
 * keeps its own animation.
 */
export function subscribeLevels(listener: LevelListener): () => void {
    if (!levelsSupported() || prefersLessMotion()) return () => {}
    listeners.add(listener)
    if (!frame) frame = requestAnimationFrame(tick)
    return () => {
        listeners.delete(listener)
        if (listeners.size) return
        cancelAnimationFrame(frame)
        frame = 0
        silent = false
        detach()
    }
}
