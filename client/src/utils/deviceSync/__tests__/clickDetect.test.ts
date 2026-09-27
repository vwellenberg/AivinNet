import { describe, expect, it } from 'vitest'

import { MIN_STRENGTH } from '@/utils/deviceSync/calibration'
import { correlationEnvelope, fft, findArrival } from '@/utils/deviceSync/clickDetect'
import { chirp, CHIRP_BAND_HZ } from '@/utils/deviceSync/clickSignal'
import { gaussian, prng, roomRecording } from './calibrationSignal'

const SR = 48000

describe('fft', () => {
    it('matches the textbook DFT, and the inverse brings the signal back', () => {
        const rand = prng(1)
        const n = 16
        const input = Array.from({ length: n }, () => rand() - 0.5)
        const re = Float64Array.from(input)
        const im = new Float64Array(n)
        fft(re, im)

        for (let k = 0; k < n; k++) {
            let sumRe = 0
            let sumIm = 0
            for (let t = 0; t < n; t++) {
                sumRe += input[t] * Math.cos((-2 * Math.PI * k * t) / n)
                sumIm += input[t] * Math.sin((-2 * Math.PI * k * t) / n)
            }
            expect(re[k]).toBeCloseTo(sumRe, 9)
            expect(im[k]).toBeCloseTo(sumIm, 9)
        }

        fft(re, im, true)
        input.forEach((value, t) => {
            expect(re[t]).toBeCloseTo(value, 9)
            expect(im[t]).toBeCloseTo(0, 9)
        })
    })
})

describe('findArrival', () => {
    const template = chirp(SR)

    it('finds a click to the sample, even under noise', () => {
        const at = 21000
        const recording = roomRecording({
            sampleRate: SR,
            startServerMs: 0,
            durationMs: 1000,
            arrivals: [{ atMs: (at / SR) * 1000, gain: 0.05 }],
            noise: 0.02,
        })
        const envelope = correlationEnvelope(recording, template, SR, CHIRP_BAND_HZ)
        const arrival = findArrival(envelope, SR, recording.length - template.length)

        expect(arrival).not.toBeNull()
        expect(Math.abs(arrival!.index - at)).toBeLessThanOrEqual(1)
        expect(arrival!.strength).toBeGreaterThan(MIN_STRENGTH)
    })

    it('takes the direct sound, not the louder reflection right behind it', () => {
        const at = 12000
        const click = chirp(SR)
        const signal = new Float32Array(48000)
        const echo = at + Math.round(0.006 * SR)
        for (let i = 0; i < click.length; i++) {
            signal[at + i] += 0.5 * click[i]
            signal[echo + i] += 0.9 * click[i]
        }
        const envelope = correlationEnvelope(signal, template, SR, CHIRP_BAND_HZ)
        const arrival = findArrival(envelope, SR, signal.length - template.length)

        expect(Math.abs(arrival!.index - at)).toBeLessThanOrEqual(1)
    })

    it('does not care which way round a speaker is wired', () => {
        const at = 9000
        const recording = roomRecording({
            sampleRate: SR,
            startServerMs: 0,
            durationMs: 600,
            arrivals: [{ atMs: (at / SR) * 1000, gain: -0.2 }],
            noise: 0.005,
        })
        const envelope = correlationEnvelope(recording, template, SR, CHIRP_BAND_HZ)
        expect(Math.abs(findArrival(envelope, SR, recording.length)!.index - at)).toBeLessThanOrEqual(1)
    })

    it('stays well below the "heard" bar on noise alone', () => {
        const rand = prng(42)
        for (let round = 0; round < 5; round++) {
            const noise = Float32Array.from({ length: 57600 }, () => 0.05 * gaussian(rand))
            const envelope = correlationEnvelope(noise, template, SR, CHIRP_BAND_HZ)
            const arrival = findArrival(envelope, SR, noise.length - template.length)
            expect(arrival!.strength).toBeLessThan(MIN_STRENGTH * 0.75)
        }
    })
})
