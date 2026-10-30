/**
 * The sleep timer's clock, fade and track-boundary answers, against a stubbed
 * player (the volume path is `setDuck`, spied) and a stubbed queue whose
 * `playPause` is the pause button's action (spied). The real player wiring is
 * in sleepTimerPlayer.test.ts.
 */

import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import useSleepTimer from '@/stores/sleepTimer'
import useQueue from '@/stores/queue'

const { duck } = vi.hoisted(() => ({ duck: { setDuck: vi.fn() } }))

vi.mock('@/stores/player', () => ({ usePlayer: () => duck }))

// The queue's `playPause` mirrors the real toggle for the one case that
// matters here: pausing a playing queue. Reactive, so a group-mode `playing`
// flip is seen by the store's watcher.
vi.mock('@/stores/queue', async () => {
    const { reactive } = await import('vue')
    const queue = reactive({
        playing: true,
        currentindex: 0,
        playPause: vi.fn(() => {
            if (queue.playing) queue.playing = false
        }),
    })
    return { default: () => queue }
})

const song = (trackhash: string, albumhash: string): any => ({ trackhash, albumhash, title: trackhash })

const MIN = 60_000
const FADE = 20_000

function queueMock(): any {
    return useQueue()
}

describe('sleep timer: minutes', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        duck.setDuck.mockReset()
        queueMock().playing = true
        queueMock().playPause.mockClear()
    })

    afterEach(() => {
        useSleepTimer().cancel()
        vi.useRealTimers()
    })

    it('fades the music out after the time runs out, pauses through the pause action, and restores the level', () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        sleep.arm({ kind: 'minutes', minutes: 15 })

        vi.advanceTimersByTime(15 * MIN - 1)
        expect(duck.setDuck).not.toHaveBeenCalled()
        expect(queue.playPause).not.toHaveBeenCalled()

        // The fade starts at the stroke of the time, halfway through at 10 s.
        vi.advanceTimersByTime(1 + 10_000)
        const midGain = duck.setDuck.mock.calls.at(-1)?.[0]
        expect(midGain).toBeCloseTo(0.5, 1)
        expect(queue.playPause).not.toHaveBeenCalled()

        vi.advanceTimersByTime(FADE - 10_000)
        expect(queue.playPause).toHaveBeenCalledTimes(1)
        expect(queue.playing).toBe(false)
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)
        expect(sleep.active).toBe(false)

        // Nothing fires again after the end.
        duck.setDuck.mockClear()
        vi.advanceTimersByTime(MIN)
        expect(duck.setDuck).not.toHaveBeenCalled()
        expect(queue.playPause).toHaveBeenCalledTimes(1)
    })

    it('never starts the music: a timer that runs out while paused only restores the level', () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        queue.playing = false
        sleep.arm({ kind: 'minutes', minutes: 15 })

        vi.advanceTimersByTime(15 * MIN + FADE)
        expect(queue.playPause).not.toHaveBeenCalled()
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)
        expect(sleep.active).toBe(false)
    })

    it('cancel before the time: no pause, no fade, the timer is gone', () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        sleep.arm({ kind: 'minutes', minutes: 30 })
        vi.advanceTimersByTime(5 * MIN)

        sleep.cancel()
        expect(sleep.active).toBe(false)

        vi.advanceTimersByTime(60 * MIN)
        expect(queue.playPause).not.toHaveBeenCalled()
        expect(duck.setDuck).not.toHaveBeenCalled()
    })

    it('cancel during the fade: the music comes back to full, nothing is paused', () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        sleep.arm({ kind: 'minutes', minutes: 15 })
        vi.advanceTimersByTime(15 * MIN + 5_000)
        expect(duck.setDuck.mock.calls.at(-1)?.[0]).toBeLessThan(1)

        sleep.cancel()
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)

        duck.setDuck.mockClear()
        vi.advanceTimersByTime(FADE * 2)
        expect(duck.setDuck).not.toHaveBeenCalled()
        expect(queue.playPause).not.toHaveBeenCalled()
    })

    it('arming a new timer during a fade restores the level first and replaces the old one', () => {
        const sleep = useSleepTimer()
        sleep.arm({ kind: 'minutes', minutes: 15 })
        vi.advanceTimersByTime(15 * MIN + 5_000)

        sleep.arm({ kind: 'minutes', minutes: 60 })
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)
        expect(sleep.fading).toBe(false)
        expect(sleep.label).toBe('60 min')
    })

    it('a group pause lands later: the level comes back only once the queue reports paused', async () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        // Group mode: the pause is a command, the local flag does not move yet.
        queue.playPause.mockImplementationOnce(() => {})
        sleep.arm({ kind: 'minutes', minutes: 15 })
        vi.advanceTimersByTime(15 * MIN + FADE)

        expect(queue.playPause).toHaveBeenCalledTimes(1)
        // Silent, and still silent: the local element has not been paused yet.
        expect(duck.setDuck.mock.calls.at(-1)?.[0]).toBe(0)

        queue.playing = false
        await nextTick()
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)
    })

    it('a group pause that never lands still restores the level after the fallback', () => {
        const sleep = useSleepTimer()
        const queue = queueMock()
        queue.playPause.mockImplementationOnce(() => {})
        sleep.arm({ kind: 'minutes', minutes: 15 })
        vi.advanceTimersByTime(15 * MIN + FADE)
        expect(duck.setDuck.mock.calls.at(-1)?.[0]).toBe(0)

        vi.advanceTimersByTime(5_000)
        expect(duck.setDuck).toHaveBeenLastCalledWith(1)
    })

    it('the indicator counts down in whole minutes, rounded up', () => {
        const sleep = useSleepTimer()
        sleep.arm({ kind: 'minutes', minutes: 15 })
        expect(sleep.label).toBe('15 min')
        vi.advanceTimersByTime(MIN + 1)
        expect(sleep.label).toBe('14 min')
        vi.advanceTimersByTime(13 * MIN)
        expect(sleep.label).toBe('1 min')
    })
})

describe('sleep timer: the track boundary', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        queueMock().playPause.mockClear()
    })

    afterEach(() => {
        useSleepTimer().cancel()
    })

    it('end of song: the next track change stops playback, once, and the timer is spent', () => {
        const sleep = useSleepTimer()
        sleep.arm({ kind: 'song' })
        const a = song('a', 'album1')
        const b = song('b', 'album1')

        expect(sleep.takeStopAt(a, b)).toBe(true)
        expect(sleep.active).toBe(false)
        // The next boundary is not stopped by a spent timer.
        expect(sleep.takeStopAt(b, song('c', 'album1'))).toBe(false)
    })

    it('end of album: stops only when the next track is on another album', () => {
        const sleep = useSleepTimer()
        sleep.arm({ kind: 'album' })
        const a1 = song('a1', 'albumA')

        expect(sleep.takeStopAt(a1, song('a2', 'albumA'))).toBe(false)
        expect(sleep.active).toBe(true)

        expect(sleep.takeStopAt(song('a2', 'albumA'), song('b1', 'albumB'))).toBe(true)
        expect(sleep.active).toBe(false)
    })

    it('minute timers never answer at a boundary: they end through the clock', () => {
        const sleep = useSleepTimer()
        sleep.arm({ kind: 'minutes', minutes: 15 })
        expect(sleep.takeStopAt(song('a', 'x'), song('b', 'y'))).toBe(false)
        expect(sleep.active).toBe(true)
    })

    it('without a timer nothing stops', () => {
        expect(useSleepTimer().takeStopAt(song('a', 'x'), song('b', 'y'))).toBe(false)
    })
})
