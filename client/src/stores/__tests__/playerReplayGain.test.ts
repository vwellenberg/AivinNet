/**
 * ReplayGain in the player (#643): each of the two elements plays at the
 * volume setting times the gain of the track it holds, through preload,
 * switch, duck, a volume change and a change of the mode itself.
 */

import { createPinia, setActivePinia } from 'pinia'
import { nextTick, reactive } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { settings } = vi.hoisted(() => ({
    settings: {
        volume: 0.8,
        mute: false,
        crossfade_duration: 0,
        use_crossfade: false,
        replaygain: 'off' as 'off' | 'track' | 'album',
    },
}))

vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))
vi.mock('@/stores/colors', () => ({ default: () => ({}) }))
vi.mock('@/stores/lyrics', () => ({ default: () => ({}) }))
vi.mock('@/stores/tracker', () => ({ default: () => ({ reassignEventListener: vi.fn(), changeKey: vi.fn() }) }))
vi.mock('@/stores/notification', () => ({ NotifType: {}, useToast: () => ({ showNotification: vi.fn() }) }))
vi.mock('@/stores/queue', () => ({ default: () => ({ playing: false, setCurrentDuration: vi.fn() }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({}) }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false }) }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))

// Reactive, so the player's watch on the mode fires like on the real store.
const live = reactive(settings)
vi.mock('@/stores/settings', () => ({ default: () => live }))
vi.mock('../../stores/settings', () => ({ default: () => live }))

import { audioSource, usePlayer } from '@/stores/player'
import type { Track } from '@/interfaces'

// `extra` as the server sends it (tinytag 2: lists of strings).
const LOUD = { extra: { replaygain_track_gain: ['-8.00 dB'], replaygain_album_gain: ['-6.00 dB'] } } as unknown as Track
const QUIET = { extra: { replaygain_track_gain: ['+2.00 dB'] } } as unknown as Track
const UNTAGGED = { extra: {} } as unknown as Track

/** dB → factor, with the player's 6 dB headroom. */
const at = (db: number) => Math.pow(10, (db - 6) / 20)

describe('player: ReplayGain', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        live.volume = 0.8
        live.replaygain = 'off'
        usePlayer()
        audioSource.assignSettings(live as any)
        audioSource.setDuck(1)
    })

    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('off: the volume is the setting, whatever the tags say', () => {
        const el = audioSource.preloadWithUri('http://host/file/a/legacy?filepath=a.flac', LOUD)
        expect(el.volume).toBeCloseTo(0.8, 6)
    })

    it('track: a preloaded track plays at its own gain', () => {
        live.replaygain = 'track'
        const el = audioSource.preloadWithUri('http://host/file/a/legacy?filepath=a.flac', LOUD)
        expect(el.volume).toBeCloseTo(0.8 * at(-8), 6)
    })

    it('album: the album gain wins over the track gain', () => {
        live.replaygain = 'album'
        const el = audioSource.preloadWithUri('http://host/file/a/legacy?filepath=a.flac', LOUD)
        expect(el.volume).toBeCloseTo(0.8 * at(-6), 6)
    })

    it('each element keeps the gain of the track it holds', () => {
        live.replaygain = 'track'
        audioSource.setTrack(audioSource.playingSource, QUIET)
        audioSource.applyVolumes()
        const standby = audioSource.preloadWithUri('http://host/file/b/legacy?filepath=b.flac', LOUD)

        expect(audioSource.playingSource.volume).toBeCloseTo(0.8 * at(2), 6)
        expect(standby.volume).toBeCloseTo(0.8 * at(-8), 6)
    })

    it('an untagged track only takes the headroom, like a track at the reference', () => {
        live.replaygain = 'track'
        const el = audioSource.preloadWithUri('http://host/file/u/legacy?filepath=u.flac', UNTAGGED)
        expect(el.volume).toBeCloseTo(0.8 * at(0), 6)
    })

    it('a volume change and the sync duck keep the gain', () => {
        live.replaygain = 'track'
        audioSource.setTrack(audioSource.playingSource, LOUD)

        audioSource.setVolume(0.5)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.5 * at(-8), 6)

        live.volume = 0.5
        audioSource.setDuck(0.4)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.5 * 0.4 * at(-8), 6)
    })

    it('switching the mode applies at once, to both elements', async () => {
        audioSource.setTrack(audioSource.playingSource, LOUD)
        audioSource.applyVolumes()
        const standby = audioSource.preloadWithUri('http://host/file/q/legacy?filepath=q.flac', QUIET)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.8, 6)

        live.replaygain = 'track'
        await nextTick()

        expect(audioSource.playingSource.volume).toBeCloseTo(0.8 * at(-8), 6)
        expect(standby.volume).toBeCloseTo(0.8 * at(2), 6)
    })
})
