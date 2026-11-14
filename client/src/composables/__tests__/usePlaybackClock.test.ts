import { describe, expect, it } from 'vitest'

import { MAX_EXTRAPOLATION_MS, extrapolate } from '@/composables/usePlaybackClock'

describe('playback clock: between two reports from the audio element', () => {
    it('runs on with wall time while playing', () => {
        expect(extrapolate(10_000, 500, 620, true)).toBe(10_120)
    })

    it('stands still while paused', () => {
        expect(extrapolate(10_000, 500, 5_000, false)).toBe(10_000)
    })

    it('never runs away from a stalled stream', () => {
        // Buffering: no report for two seconds, the queue still says "playing".
        expect(extrapolate(10_000, 500, 2_500, true)).toBe(10_000 + MAX_EXTRAPOLATION_MS)
    })

    it('never runs backwards', () => {
        expect(extrapolate(10_000, 500, 400, true)).toBe(10_000)
    })
})
