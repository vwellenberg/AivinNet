import { nextTick, reactive } from 'vue'
import { describe, expect, it, vi } from 'vitest'

import { countDownOnStart } from '@/helpers/almostCompleteCountdown'

describe('countDownOnStart (#529)', () => {
    it('reports each song that starts playing, wherever it was started from', async () => {
        const queue = reactive({ playing: false, currenttrackhash: 't1' })
        const noteStarted = vi.fn()
        const stop = countDownOnStart(queue, noteStarted)

        // Loaded but paused (a queue restored after a reload): nothing started.
        expect(noteStarted).not.toHaveBeenCalled()

        queue.playing = true
        await nextTick()
        expect(noteStarted).toHaveBeenLastCalledWith('t1')

        queue.currenttrackhash = 't2'
        await nextTick()
        expect(noteStarted).toHaveBeenLastCalledWith('t2')
        expect(noteStarted).toHaveBeenCalledTimes(2)
        stop()
    })

    it('says nothing while paused, and the same song again on resume', async () => {
        const queue = reactive({ playing: true, currenttrackhash: 't1' })
        const noteStarted = vi.fn()
        const stop = countDownOnStart(queue, noteStarted)
        expect(noteStarted).toHaveBeenCalledTimes(1)

        queue.playing = false
        await nextTick()
        queue.currenttrackhash = 't2'
        await nextTick()
        expect(noteStarted).toHaveBeenCalledTimes(1)

        queue.playing = true
        await nextTick()
        expect(noteStarted).toHaveBeenLastCalledWith('t2')
        stop()
    })
})
