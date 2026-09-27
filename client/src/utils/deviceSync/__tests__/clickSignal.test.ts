import { describe, expect, it } from 'vitest'

import { chirp, CHIRP_MS, clickSample, clickStartMs, clickWav } from '@/utils/deviceSync/clickSignal'

describe('clickWav', () => {
    it('writes a mono 16-bit PCM WAV header that matches its data', () => {
        const wav = clickWav({ sampleRate: 48000, durationMs: 500, clicksMs: [100], amplitude: 0.5 })
        const view = new DataView(wav)
        const text = (at: number, n: number) =>
            String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(at + i)))

        expect(text(0, 4)).toBe('RIFF')
        expect(text(8, 4)).toBe('WAVE')
        expect(view.getUint16(20, true)).toBe(1) // PCM
        expect(view.getUint16(22, true)).toBe(1) // mono
        expect(view.getUint32(24, true)).toBe(48000)
        expect(view.getUint16(34, true)).toBe(16)
        expect(text(36, 4)).toBe('data')
        expect(view.getUint32(40, true)).toBe(24000 * 2)
        expect(wav.byteLength).toBe(44 + 24000 * 2)
        expect(view.getUint32(4, true)).toBe(wav.byteLength - 8)
    })

    it('puts each click on the sample its reported time names, silence everywhere else', () => {
        const sampleRate = 48000
        const clicksMs = [100.01, 300.4]
        const wav = clickWav({ sampleRate, durationMs: 500, clicksMs, amplitude: 0.5 })
        const view = new DataView(wav)
        const sample = (i: number) => view.getInt16(44 + i * 2, true)
        const length = chirp(sampleRate).length

        for (const ms of clicksMs) {
            const start = clickSample(ms, sampleRate)
            // The report (clickStartMs) and the file agree on where a click begins.
            expect(clickStartMs(ms, sampleRate)).toBeCloseTo((start / sampleRate) * 1000, 9)
            expect(sample(start - 1)).toBe(0)
            const body = Array.from({ length }, (_, i) => Math.abs(sample(start + i)))
            expect(Math.max(...body)).toBeGreaterThan(0.45 * 32767)
            expect(Math.max(...body)).toBeLessThanOrEqual(0.5 * 32767 + 1)
            expect(sample(start + length + 1)).toBe(0)
        }
        expect(sample(clickSample(200, sampleRate))).toBe(0)
    })

    it('is a short chirp of the documented length', () => {
        expect(chirp(48000).length).toBe((CHIRP_MS / 1000) * 48000)
        expect(chirp(16000).length).toBe((CHIRP_MS / 1000) * 16000)
    })
})
