import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { micAvailable, startMicCapture } from '@/utils/deviceSync/micCapture'

// The browser side is faked: an AudioContext, the worklet node (whose port the
// test posts chunks through, as the real worklet does) and getUserMedia.
const nodes: any[] = []
const track = { stop: vi.fn() }
let context: any

class FakeAudioContext {
    sampleRate = 48000
    audioWorklet = { addModule: vi.fn(() => Promise.resolve()) }
    resume = vi.fn(() => Promise.resolve())
    close = vi.fn(() => Promise.resolve())
    source = { connect: vi.fn(), disconnect: vi.fn() }
    createMediaStreamSource = vi.fn(() => this.source)
    constructor() {
        context = this
    }
}

class FakeWorkletNode {
    port = { onmessage: null as null | ((event: any) => void) }
    constructor(public ctx: any, public name: string, public opts: any) {
        nodes.push(this)
    }
}

const getUserMedia = vi.fn()

/** The worklet posts a chunk starting at context frame `frame`, delivered at local time `at`. */
function deliver(frame: number, values: number[], at: number) {
    vi.setSystemTime(at)
    nodes[0].port.onmessage({ data: { frame, data: Float32Array.from(values) } })
}

describe('micCapture', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        nodes.length = 0
        vi.clearAllMocks()
        vi.stubGlobal('AudioContext', FakeAudioContext)
        vi.stubGlobal('AudioWorkletNode', FakeWorkletNode)
        Object.defineProperty(navigator, 'mediaDevices', { value: { getUserMedia }, configurable: true })
        getUserMedia.mockResolvedValue({ getTracks: () => [track] })
        URL.createObjectURL = vi.fn(() => 'blob:worklet')
        URL.revokeObjectURL = vi.fn()
    })

    afterEach(() => {
        vi.useRealTimers()
        vi.unstubAllGlobals()
    })

    it('asks for the raw microphone — no echo cancellation, noise filter or auto gain', async () => {
        await startMicCapture()
        expect(getUserMedia).toHaveBeenCalledWith({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        })
        expect(context.audioWorklet.addModule).toHaveBeenCalledWith('blob:worklet')
        expect(context.source.connect).toHaveBeenCalledWith(nodes[0])
    })

    it('keeps every chunk in order and dates sample 0 by the promptest delivery', async () => {
        const capture = await startMicCapture()
        expect(capture.startLocalMs()).toBeNull()

        // 48 samples = 1 ms. The first chunk arrives 5 ms after its last sample,
        // the second only 1 ms after — the tighter bound wins.
        deliver(1000, new Array(48).fill(0.5), 10_006)
        deliver(1048, new Array(48).fill(-0.25), 10_003)
        deliver(1096, new Array(48).fill(0), 10_050) // a late one changes nothing

        expect(capture.startLocalMs()).toBe(10_003 - 2)
        const samples = capture.samples()
        expect(samples).toHaveLength(144)
        expect(samples[0]).toBe(0.5)
        expect(samples[48]).toBe(-0.25)
        expect(capture.level()).toBe(0)
    })

    it('lets go of the microphone and the context on stop', async () => {
        const capture = await startMicCapture()
        capture.stop()
        expect(track.stop).toHaveBeenCalled()
        expect(context.close).toHaveBeenCalled()
        expect(nodes[0].port.onmessage).toBeNull()
        expect(capture.samples()).toHaveLength(0)
    })

    it('closes the context again when the microphone is refused', async () => {
        getUserMedia.mockRejectedValue(Object.assign(new Error('no'), { name: 'NotAllowedError' }))
        await expect(startMicCapture()).rejects.toMatchObject({ name: 'NotAllowedError' })
        expect(context.close).toHaveBeenCalled()
        expect(nodes).toHaveLength(0)
    })

    it('is only offered on a secure page', () => {
        vi.stubGlobal('isSecureContext', false)
        expect(micAvailable()).toBe(false)
        vi.stubGlobal('isSecureContext', true)
        expect(micAvailable()).toBe(true)
    })
})
