/**
 * A sync calibration plays its clicks OVER the music, turned down, instead of
 * pausing it (2026-09-27): a paused Bluetooth path on Windows goes cold and
 * then measures ~150 ms short of the delay the music runs with. The duck lives
 * in the player, apart from the volume setting — that one is the user's, it is
 * persisted and shown in the device list.
 */

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { settings } = vi.hoisted(() => ({
    settings: { volume: 0.8, mute: false, crossfade_duration: 0, use_crossfade: false },
}))

// The player drags in half the app; none of it matters for the volume.
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))
vi.mock('@/stores/colors', () => ({ default: () => ({}) }))
vi.mock('@/stores/lyrics', () => ({ default: () => ({}) }))
vi.mock('@/stores/tracker', () => ({ default: () => ({ reassignEventListener: vi.fn(), changeKey: vi.fn() }) }))
vi.mock('@/stores/notification', () => ({ NotifType: {}, useToast: () => ({ showNotification: vi.fn() }) }))
vi.mock('@/stores/queue', () => ({ default: () => ({ playing: false, setCurrentDuration: vi.fn() }) }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({}) }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: true }) }))
vi.mock('@/stores/settings', () => ({ default: () => settings }))
vi.mock('@/helpers/mediaNotification', () => ({ default: vi.fn() }))

import { audioSource, usePlayer } from '@/stores/player'

const track: any = { filepath: '/music/next.flac', trackhash: 'next', title: 'Next' }

describe('player: the music ducks under a calibration', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        setActivePinia(createPinia())
        // jsdom implements none of these.
        vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {})
        vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {})
        settings.volume = 0.8
        usePlayer().setDuck(1)
    })

    afterEach(() => {
        vi.restoreAllMocks()
        vi.useRealTimers()
    })

    it('turns both music elements down and back up — the setting stays the user’s', () => {
        const player = usePlayer()
        player.setDuck(0.1)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.08, 6)
        expect(audioSource.standbySource.volume).toBeCloseTo(0.08, 6)
        expect(settings.volume).toBe(0.8)

        player.setDuck(1)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.8, 6)
        expect(audioSource.standbySource.volume).toBeCloseTo(0.8, 6)
    })

    it('a volume change during the duck stays ducked, and comes back at the new level', () => {
        const player = usePlayer()
        player.setDuck(0.1)
        // What settings.setVolume does: the element first, then the setting.
        player.setVolume(0.5)
        settings.volume = 0.5
        expect(audioSource.playingSource.volume).toBeCloseTo(0.05, 6)

        player.setDuck(1)
        expect(audioSource.playingSource.volume).toBeCloseTo(0.5, 6)
    })

    it('the next track of the group comes in ducked while the duck lasts', () => {
        const player = usePlayer()
        player.setDuck(0.1)
        player.prepareGroupStandby(track, 0, 'k1')
        expect(audioSource.standbySource.volume).toBeCloseTo(0.08, 6)

        player.setDuck(1)
        player.prepareGroupStandby(track, 0, 'k2')
        expect(audioSource.standbySource.volume).toBeCloseTo(0.8, 6)
    })
})
