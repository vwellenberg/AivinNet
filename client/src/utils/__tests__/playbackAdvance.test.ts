import { describe, expect, it } from 'vitest'

import { stopsAtQueueEnd } from '@/utils/playbackAdvance'

describe('stopsAtQueueEnd', () => {
    it('never stops while repeat is on', () => {
        expect(stopsAtQueueEnd('all', false, 50)).toBe(false)
        expect(stopsAtQueueEnd('one', false, 50)).toBe(false)
        expect(stopsAtQueueEnd('all', true, 50)).toBe(false)
    })

    it('stops at the last row without repeat and without shuffle', () => {
        expect(stopsAtQueueEnd('none', false, 50)).toBe(true)
    })

    it('keeps rolling under shuffle — the last ROW is not the end (#323)', () => {
        // The regression: a random pick that landed on the last index used to
        // skip the preload and pause the queue mid-shuffle.
        expect(stopsAtQueueEnd('none', true, 50)).toBe(false)
        expect(stopsAtQueueEnd('none', true, 2)).toBe(false)
    })

    it('still stops when there is nothing to roll to', () => {
        // One track and "keep rolling" would quietly become repeat-one.
        expect(stopsAtQueueEnd('none', true, 1)).toBe(true)
        expect(stopsAtQueueEnd('none', true, 0)).toBe(true)
    })
})
