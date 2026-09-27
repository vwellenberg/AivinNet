// Raw microphone samples for the sync calibration (listening device only).
//
// Echo cancellation, noise suppression and auto gain OFF: echo cancellation
// would subtract this device's own click from the recording (it plays one
// too), and the other two smear exactly the onsets the detector looks for.
//
// The recording is kept in memory for the one measurement and dropped with
// `stop()` — it never leaves the device.
//
// Browsers only hand out the microphone on secure pages (https:// or
// localhost); `micAvailable()` says whether this one is.

/** Frames per message from the worklet (~43 ms at 48 kHz). */
const CHUNK = 2048

const WORKLET = `
class AivinNetCapture extends AudioWorkletProcessor {
    constructor() {
        super()
        this.buf = new Float32Array(${CHUNK})
        this.n = 0
        this.first = 0
    }
    process(inputs) {
        const channel = inputs[0] && inputs[0][0]
        if (!channel) return true
        let i = 0
        while (i < channel.length) {
            if (this.n === 0) this.first = currentFrame + i
            const take = Math.min(channel.length - i, this.buf.length - this.n)
            this.buf.set(channel.subarray(i, i + take), this.n)
            this.n += take
            i += take
            if (this.n === this.buf.length) {
                this.port.postMessage({ frame: this.first, data: this.buf }, [this.buf.buffer])
                this.buf = new Float32Array(${CHUNK})
                this.n = 0
            }
        }
        return true
    }
}
registerProcessor('aivinnet-capture', AivinNetCapture)
`

export function micAvailable(): boolean {
    return (
        typeof window !== 'undefined' &&
        window.isSecureContext === true &&
        typeof navigator !== 'undefined' &&
        typeof navigator.mediaDevices?.getUserMedia === 'function' &&
        typeof AudioWorkletNode !== 'undefined'
    )
}

export interface MicCapture {
    sampleRate: number
    /**
     * Local wall-clock time (Date.now()) of `samples()[0]`, or null before the
     * first chunk. Late by the microphone's own delay, which is the same for
     * every click and cancels out.
     */
    startLocalMs(): number | null
    /** Everything recorded so far. */
    samples(): Float32Array
    /** Loudness of the latest chunk, 0..1 (RMS), for the level meter. */
    level(): number
    /** The audio setup the recording ran on, for the calibration log. */
    details(): Record<string, number | string | boolean | null>
    stop(): void
}

/**
 * Open the microphone and start recording. Call it from the click that asks
 * for it: the AudioContext is created before the first await, while the
 * gesture still counts. Rejects when the user (or the browser) says no.
 */
export async function startMicCapture(): Promise<MicCapture> {
    const context = new AudioContext()
    let stream: MediaStream | null = null
    let workletUrl = ''
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        workletUrl = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
        await context.audioWorklet.addModule(workletUrl)
        await context.resume()
    } catch (error) {
        stream?.getTracks().forEach(track => track.stop())
        void context.close()
        throw error
    } finally {
        if (workletUrl) URL.revokeObjectURL(workletUrl)
    }

    const source = context.createMediaStreamSource(stream)
    // No outputs: nothing is played back, the node only listens.
    const node = new AudioWorkletNode(context, 'aivinnet-capture', { numberOfInputs: 1, numberOfOutputs: 0 })
    source.connect(node)

    const sampleRate = context.sampleRate
    const chunks: Float32Array[] = []
    let firstFrame = -1
    let received = 0
    let startLocal: number | null = null
    let lastLevel = 0

    node.port.onmessage = (event: MessageEvent<{ frame: number; data: Float32Array }>) => {
        const { frame, data } = event.data
        if (firstFrame < 0) firstFrame = frame
        chunks.push(data)
        received += data.length

        // The chunk's last sample was captured no later than now; the tightest
        // such bound over all chunks is the best guess at when sample 0 was.
        const endFrames = frame - firstFrame + data.length
        const bound = Date.now() - (endFrames / sampleRate) * 1000
        startLocal = startLocal === null ? bound : Math.min(startLocal, bound)

        let sum = 0
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i]
        lastLevel = Math.sqrt(sum / data.length)
    }

    const ms = (seconds: number | undefined) =>
        typeof seconds === 'number' && Number.isFinite(seconds) ? Math.round(seconds * 10000) / 10 : null

    let stopped = false
    return {
        sampleRate,
        startLocalMs: () => startLocal,
        samples: () => {
            const out = new Float32Array(received)
            let at = 0
            for (const chunk of chunks) {
                out.set(chunk, at)
                at += chunk.length
            }
            return out
        },
        level: () => lastLevel,
        details: () => {
            const track = stream?.getAudioTracks()[0]
            const settings: any = track?.getSettings?.() ?? {}
            return {
                sample_rate: sampleRate,
                base_latency_ms: ms(context.baseLatency),
                output_latency_ms: ms((context as any).outputLatency),
                input_latency_ms: ms(settings.latency),
                input_sample_rate: settings.sampleRate ?? null,
                input_channels: settings.channelCount ?? null,
                echo_cancellation: settings.echoCancellation ?? null,
                auto_gain: settings.autoGainControl ?? null,
                noise_suppression: settings.noiseSuppression ?? null,
                input_label: (track?.label ?? '').slice(0, 120),
            }
        },
        stop: () => {
            if (stopped) return
            stopped = true
            node.port.onmessage = null
            source.disconnect()
            stream?.getTracks().forEach(track => track.stop())
            void context.close()
            chunks.length = 0
        },
    }
}
