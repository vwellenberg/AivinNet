import { afterEach, describe, expect, it, vi } from 'vitest'

import { staticSamples, STATIC_GAIN } from '@/utils/radioStatic'

// `playStatic` keeps its AudioContext in the module, so each test loads a fresh copy.
async function freshPlayStatic() {
    vi.resetModules()
    const mod = await import('@/utils/radioStatic')
    return mod.playStatic
}

describe('staticSamples', () => {
    it('makes exactly the requested number of samples', () => {
        expect(staticSamples(1000)).toHaveLength(1000)
        expect(staticSamples(0)).toHaveLength(0)
    })

    it('stays within [-1, 1]', () => {
        const samples = staticSamples(5000)

        expect(Math.max(...samples)).toBeLessThanOrEqual(1)
        expect(Math.min(...samples)).toBeGreaterThanOrEqual(-1)
    })

    it('starts and ends near silence, so the burst never clicks', () => {
        // A constant noise source makes the envelope visible in the output.
        const samples = staticSamples(1000, () => 1)

        // The first sample is the bottom of a 2 % fade-in: 1/20 of full level.
        expect(Math.abs(samples[0])).toBeLessThanOrEqual(0.06)
        expect(Math.abs(samples[samples.length - 1])).toBeLessThan(0.01)
        expect(samples[500]).toBeCloseTo(1)
    })

    it('takes its values from the source it is given', () => {
        // A source at 0.75 maps to +0.5 before the envelope, so every sample is positive and at most 0.5.
        expect(Array.from(staticSamples(4, () => 0.75)).every(v => v > 0 && v <= 0.5)).toBe(true)
    })
})

describe('playStatic', () => {
    afterEach(() => {
        vi.unstubAllGlobals()
    })

    function fakeAudio() {
        const started: unknown[] = []
        class FakeContext {
            sampleRate = 8000
            destination = {}
            createBuffer(_ch: number, length: number) {
                return { length, copyToChannel: vi.fn() }
            }
            createBufferSource() {
                return {
                    buffer: null as unknown,
                    connect(node: unknown) {
                        return node
                    },
                    start: () => started.push(true),
                }
            }
            createBiquadFilter() {
                return { type: '', frequency: { value: 0 }, Q: { value: 0 }, connect: (n: unknown) => n }
            }
            createGain() {
                return { gain: { value: 0 }, connect: (n: unknown) => n }
            }
            resume = vi.fn(async () => {})
        }
        vi.stubGlobal('AudioContext', FakeContext)
        return { started }
    }

    it('plays one burst and reports it', async () => {
        const playStatic = await freshPlayStatic()
        const { started } = fakeAudio()

        expect(playStatic(1_000_000)).toBe(true)
        expect(started).toHaveLength(1)
    })

    it('does not stack bursts closer together than the gap', async () => {
        const playStatic = await freshPlayStatic()
        const { started } = fakeAudio()

        expect(playStatic(2_000_000)).toBe(true)
        expect(playStatic(2_000_100)).toBe(false)
        expect(playStatic(2_000_400)).toBe(true)
        expect(started).toHaveLength(2)
    })

    it('stays silent and does not throw without Web Audio', async () => {
        const playStatic = await freshPlayStatic()
        vi.stubGlobal('AudioContext', undefined)

        expect(playStatic(3_000_000)).toBe(false)
    })

    it('keeps the gain quiet', () => {
        expect(STATIC_GAIN).toBeLessThanOrEqual(0.1)
    })
})
