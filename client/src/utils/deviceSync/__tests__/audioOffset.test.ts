import { beforeEach, describe, expect, it } from 'vitest'

import {
    clampOffset,
    loadAudioOffset,
    OFFSET_MAX_MS,
    OFFSET_MIN_MS,
    saveAudioOffset,
} from '../audioOffset'

describe('audioOffset', () => {
    beforeEach(() => localStorage.clear())

    it('defaults to no trim', () => {
        expect(loadAudioOffset()).toBe(0)
    })

    it('clamps to the slider range and rounds', () => {
        expect(clampOffset(12.6)).toBe(13)
        expect(clampOffset(OFFSET_MAX_MS + 5000)).toBe(OFFSET_MAX_MS)
        expect(clampOffset(OFFSET_MIN_MS - 5000)).toBe(OFFSET_MIN_MS)
        expect(clampOffset(Number.NaN)).toBe(0)
    })

    it('round-trips through storage', () => {
        expect(saveAudioOffset(-150)).toBe(-150)
        expect(loadAudioOffset()).toBe(-150)
    })

    it('survives a garbage value in storage', () => {
        localStorage.setItem('aivinnet.audio_offset_ms', 'not-a-number')
        expect(loadAudioOffset()).toBe(0)
    })
})
