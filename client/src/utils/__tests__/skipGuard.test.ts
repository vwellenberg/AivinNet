import { describe, expect, it } from 'vitest'

import { createSkipGuard, MAX_FAILED_IN_A_ROW } from '@/utils/skipGuard'

describe('createSkipGuard', () => {
    it('skips a single broken track', () => {
        const guard = createSkipGuard()
        expect(guard.failed()).toBe(true)
    })

    it(`stops at the ${MAX_FAILED_IN_A_ROW}th failure in a row instead of running through the queue`, () => {
        // The live bug: a queue of 41 stale tracks, every one a 404, skipped
        // through in seconds with a toast per track.
        const guard = createSkipGuard()
        const verdicts = Array.from({ length: 41 }, () => guard.failed())

        expect(verdicts.slice(0, MAX_FAILED_IN_A_ROW - 1).every(Boolean)).toBe(true)
        expect(verdicts[MAX_FAILED_IN_A_ROW - 1]).toBe(false)
    })

    it('after stopping, the next start gets the full allowance again', () => {
        const guard = createSkipGuard()
        for (let i = 0; i < MAX_FAILED_IN_A_ROW; i++) guard.failed()

        // A new album whose first file is broken: skipped, not stopped.
        expect(guard.failed()).toBe(true)
    })

    it('a track that loads resets the count: scattered broken files never stop playback', () => {
        const guard = createSkipGuard()

        for (let i = 0; i < 10; i++) {
            expect(guard.failed()).toBe(true)
            expect(guard.failed()).toBe(true)
            guard.loaded()
        }
    })
})
