/**
 * Two elements take turns; each switch fades the old one out and releases it
 * at the end. A second switch within the fade hands the element that is still
 * fading out straight back — the fade must stop then, or it turns the new
 * track down to silence and unloads it ("Can't load", skip, next).
 */

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { settings } = vi.hoisted(() => ({
    settings: { volume: 0.8, mute: false, crossfade_duration: 3000, use_crossfade: true },
}))

vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))
vi.mock('@/stores/colors', () => ({ default: () => ({}) }))
vi.mock('@/stores/lyrics', () => ({ default: () => ({}) }))
vi.mock('@/stores/tracker', () => ({ default: () => ({ reassignEventListener: vi.fn(), changeKey: vi.fn() }) }))
vi.mock('@/stores/notification', () => ({ NotifType: {}, useToast: () => ({ showNotification: vi.fn() }) }))
vi.mock('@/stores/queue', () => ({ default: () => ({ playing: false, setCurrentDuration: vi.fn() }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({}) }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false }) }))
vi.mock('@/stores/settings', () => ({ default: () => settings }))
vi.mock('../../stores/settings', () => ({ default: () => settings }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))

import { audioSource, usePlayer } from '@/stores/player'

describe('player: a quick second switch', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        usePlayer()
        audioSource.assignSettings(settings as any)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('does not unload the track on the element it hands back', () => {
        const first = audioSource.playingSource
        first.src = 'http://host/file/a/legacy?filepath=a.flac'

        audioSource.switchSources() // `first` fades out, release due in 3 s
        vi.advanceTimersByTime(500)

        audioSource.switchSources() // ...and is the playing element again
        expect(audioSource.playingSource).toBe(first)
        first.src = 'http://host/file/c/legacy?filepath=c.flac'

        vi.advanceTimersByTime(5000)

        expect(first.getAttribute('src')).toBe('http://host/file/c/legacy?filepath=c.flac')
        expect(first.volume).toBeCloseTo(0.8, 6)
    })

    // A short next track is preloaded onto the standby right away — while that
    // element is still fading out from the switch. The fade must not unload
    // the preload at its end.
    it('does not unload a track preloaded onto the element still fading out', () => {
        const first = audioSource.playingSource
        first.src = 'http://host/file/a/legacy?filepath=a.flac'

        audioSource.switchSources()
        vi.advanceTimersByTime(500)

        const preloaded = audioSource.preloadWithUri('http://host/file/n/legacy?filepath=n.flac')
        expect(preloaded).toBe(first)

        vi.advanceTimersByTime(5000)

        expect(first.getAttribute('src')).toBe('http://host/file/n/legacy?filepath=n.flac')
        expect(first.volume).toBeCloseTo(0.8, 6)
    })
})
