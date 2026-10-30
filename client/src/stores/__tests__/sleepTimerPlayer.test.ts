/**
 * The sleep timer at the player's track boundaries, with the REAL player store:
 * the `ended` handler (no preload) and the gapless switch (`moveLoadedForward`,
 * driven by the preload timer). The queue and tracklist are stubs; the question
 * here is what the player starts and what it pauses.
 *
 * The point of the stop: the next track is queued but never started, so no
 * `play()` is ever issued that a pause would have to race (that race is an
 * AbortError toast in the player).
 */

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One stub state for the queue, the tracklist and the settings. Hoisted so the
// module mocks below can read it.
const state = vi.hoisted(() => {
    const s: any = {
        tracks: [] as any[],
        settings: {
            repeat: 'all',
            shuffle: false,
            volume: 1,
            mute: false,
            crossfade_duration: 0,
            use_crossfade: false,
            use_silence_skip: false,
        },
    }
    s.queue = {
        playing: true,
        currentindex: 0,
        get next() {
            return s.tracks[(s.queue.currentindex + 1) % s.tracks.length]
        },
        get currenttrack() {
            return s.tracks[s.queue.currentindex]
        },
        setCurrentDuration: () => {},
        setDurationFromFile: () => {},
        setPlaying: () => {},
        playNext: vi.fn(() => {
            s.queue.currentindex = (s.queue.currentindex + 1) % s.tracks.length
        }),
        moveForward: vi.fn(() => {
            s.queue.currentindex = (s.queue.currentindex + 1) % s.tracks.length
        }),
        playPause: vi.fn(),
    }
    return s
})

vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))
vi.mock('@/stores/colors', () => ({ default: () => ({ setTheme1Color: vi.fn() }) }))
vi.mock('@/stores/lyrics', () => ({
    default: () => ({ exists: false, clearNextLineTimer: vi.fn(), setCurrentLine: vi.fn(), getLyrics: vi.fn() }),
}))
vi.mock('@/stores/tracker', () => ({
    default: () => ({ reassignEventListener: vi.fn(), changeKey: vi.fn(), submitData: vi.fn() }),
}))
vi.mock('@/stores/notification', () => ({ NotifType: {}, useToast: () => ({ showNotification: vi.fn() }) }))
vi.mock('@/stores/queue', () => ({ default: () => state.queue }))
vi.mock('@/stores/queue/tracklist', () => ({
    default: () => ({
        tracklist: state.tracks,
        get length() {
            return state.tracks.length
        },
    }),
}))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false }) }))
vi.mock('@/stores/settings', () => ({ default: () => state.settings }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))

import { audioSource, usePlayer } from '@/stores/player'
import useSleepTimer from '@/stores/sleepTimer'

const track = (n: number, albumhash: string): any => ({
    filepath: `/music/${n}.flac`,
    trackhash: `hash${n}`,
    albumhash,
    title: `Track ${n}`,
    image: 'x.webp?pathhash=abc',
})

function setTracks(list: any[]) {
    state.tracks.splice(0, state.tracks.length, ...list)
    state.queue.currentindex = 0
    state.queue.playing = true
}

describe('sleep timer at the player boundaries (real player)', () => {
    let playSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        state.settings.repeat = 'all'
        state.settings.shuffle = false
        vi.clearAllMocks()
        // jsdom implements none of these.
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        playSpy = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve())
        // jsdom has no Media Session; the play path writes to it after play().
        Object.defineProperty(navigator, 'mediaSession', {
            value: { playbackState: 'none', setPositionState: vi.fn() },
            configurable: true,
        })
    })

    afterEach(() => {
        useSleepTimer().cancel()
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    /** The playing element reports its track as over: the `ended` handler. */
    function trackEnds() {
        audioSource.playingSource.onended?.(new Event('ended') as any)
    }

    it('end of song: the track ends, the next one is queued and the pause runs after it', () => {
        setTracks([track(1, 'A'), track(2, 'A'), track(3, 'A')])
        usePlayer()
        useSleepTimer().arm({ kind: 'song' })

        trackEnds()

        expect(state.queue.playNext).toHaveBeenCalledTimes(1)
        expect(state.queue.playPause).toHaveBeenCalledTimes(1)
        expect(state.queue.playPause.mock.invocationCallOrder[0]).toBeGreaterThan(
            state.queue.playNext.mock.invocationCallOrder[0]
        )
        expect(state.queue.currentindex).toBe(1)
        expect(useSleepTimer().active).toBe(false)
    })

    it('end of album: the same album plays on, the timer waits', () => {
        setTracks([track(1, 'A'), track(2, 'A')])
        usePlayer()
        useSleepTimer().arm({ kind: 'album' })

        trackEnds()

        expect(state.queue.playNext).toHaveBeenCalledTimes(1)
        expect(state.queue.playPause).not.toHaveBeenCalled()
        expect(useSleepTimer().active).toBe(true)
    })

    it('end of album: a new album pauses at the boundary', () => {
        setTracks([track(1, 'A'), track(2, 'B')])
        usePlayer()
        useSleepTimer().arm({ kind: 'album' })

        trackEnds()

        expect(state.queue.playPause).toHaveBeenCalledTimes(1)
        expect(useSleepTimer().active).toBe(false)
    })

    it('gapless song: the preloaded next track is switched in but never started', () => {
        setTracks([track(1, 'A'), track(2, 'A')])
        usePlayer()
        useSleepTimer().arm({ kind: 'song' })

        const playing = audioSource.playingSource
        Object.defineProperty(playing, 'duration', { value: 10, configurable: true })
        Object.defineProperty(playing, 'currentTime', { value: 9.9, writable: true, configurable: true })
        // Preload: the playing element's timeupdate starts loading the next track…
        playing.ontimeupdate?.(new Event('timeupdate') as any)
        // …which reports itself ready, and the next timeupdate arms the switch.
        audioSource.standbySource.oncanplay?.(new Event('canplay') as any)
        playing.ontimeupdate?.(new Event('timeupdate') as any)

        vi.advanceTimersByTime(500)

        expect(state.queue.moveForward).toHaveBeenCalledTimes(1)
        expect(state.queue.playPause).toHaveBeenCalledTimes(1)
        expect(playSpy).not.toHaveBeenCalled()
        expect(useSleepTimer().active).toBe(false)
    })

    it('without a timer the gapless switch starts the next track as before', () => {
        setTracks([track(1, 'A'), track(2, 'A')])
        usePlayer()

        const playing = audioSource.playingSource
        Object.defineProperty(playing, 'duration', { value: 10, configurable: true })
        Object.defineProperty(playing, 'currentTime', { value: 9.9, writable: true, configurable: true })
        playing.ontimeupdate?.(new Event('timeupdate') as any)
        audioSource.standbySource.oncanplay?.(new Event('canplay') as any)
        playing.ontimeupdate?.(new Event('timeupdate') as any)

        vi.advanceTimersByTime(500)

        expect(state.queue.moveForward).toHaveBeenCalledTimes(1)
        expect(state.queue.playPause).not.toHaveBeenCalled()
        expect(playSpy).toHaveBeenCalled()
    })
})
