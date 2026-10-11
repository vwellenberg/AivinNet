import { describe, expect, it, vi } from 'vitest'

import { binEdges, bandLevels, levelsSupported, normalizeLevels, quantizeLevel, subscribeLevels } from '@/utils/audioLevels'

// The analyser's maths, pure. The browser tap itself (captureStream on a live
// element) is measured headless on the server, not here: jsdom has no
// captureStream, so the subscription must stay inert.

describe('binEdges', () => {
    it('puts the band edges on the analyser bins for 48 kHz and 1024 points', () => {
        // bin = Hz * 1024 / 48000: 60 Hz -> 1, 250 -> 5, 1 kHz -> 21, 4 kHz -> 85, 12 kHz -> 256
        expect(binEdges(48000, 1024)).toEqual([1, 5, 21, 85, 256])
    })

    it('never points past the last bin', () => {
        expect(binEdges(8000, 1024, [60, 20000])).toEqual([8, 512])
    })
})

describe('bandLevels', () => {
    const edges = [1, 5, 21, 85, 256]

    it('reads silence as zero in every band', () => {
        expect(bandLevels(new Uint8Array(512), edges)).toEqual([0, 0, 0, 0])
    })

    it('reads a loud 1k to 4k band as that band only', () => {
        const data = new Uint8Array(512)
        data.fill(255, 21, 85)
        expect(bandLevels(data, edges)).toEqual([0, 0, 1, 0])
    })

    it('averages a band over its bins', () => {
        const data = new Uint8Array(512)
        data.fill(255, 1, 3) // half of the 4 bins of band 0 are full
        expect(bandLevels(data, edges)[0]).toBeCloseTo(0.5)
    })
})

describe('normalizeLevels', () => {
    it('scales each band against its own recent peak, so a quiet track still fills the bars', () => {
        const peaks = [0, 0, 0, 0]
        expect(normalizeLevels([0.2, 0, 0, 0], peaks)[0]).toBe(1)
        // a quieter reading later on: about half the peak, so about half height
        expect(normalizeLevels([0.1, 0, 0, 0], peaks)[0]).toBeCloseTo(0.5, 1)
    })

    it('keeps near-silence low: the floor stops a tiny signal looking like a full bar', () => {
        const peaks = [0, 0, 0, 0]
        expect(normalizeLevels([0.02, 0, 0, 0], peaks)[0]).toBeCloseTo(0.1, 1)
    })

    it('lets a peak fall back slowly, not at once', () => {
        const peaks = [0.8, 0, 0, 0]
        normalizeLevels([0, 0, 0, 0], peaks)
        expect(peaks[0]).toBeCloseTo(0.796, 3)
    })
})

describe('quantizeLevel', () => {
    it('steps to quarters, and never goes below one lit segment', () => {
        expect(quantizeLevel(0)).toBe(0.25)
        expect(quantizeLevel(0.37)).toBe(0.25)
        expect(quantizeLevel(0.6)).toBe(0.5)
        expect(quantizeLevel(0.9)).toBe(1)
    })

    it('never goes above a full bar', () => {
        expect(quantizeLevel(1.4)).toBe(1)
    })
})

describe('subscribeLevels', () => {
    it('is inert where captureStream does not exist (jsdom)', () => {
        expect(levelsSupported()).toBe(false)
        const listener = vi.fn()
        const stop = subscribeLevels(listener)
        expect(() => stop()).not.toThrow()
        expect(listener).not.toHaveBeenCalled()
    })
})
