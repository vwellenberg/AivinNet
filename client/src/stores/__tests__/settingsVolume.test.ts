/**
 * The speaker button must always be able to produce sound again (#281).
 *
 * It used to flip the `mute` flag and nothing else. But `volume === 0` is just
 * as silent as `mute === true`, and the icon shows the same glyph for both — so
 * on a profile whose volume had reached 0, un-muting changed nothing audible
 * and nothing visible, and the control looked broken.
 *
 * On a phone that was a dead end rather than an annoyance: the volume slider is
 * hidden there, and the whole settings store is persisted, so the 0 survived
 * every reload.
 *
 * These tests are written against AUDIBILITY, not against the flag, because
 * that is the promise the button makes.
 */

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { setVolumeMock, setMuteMock, viewport } = vi.hoisted(() => ({
    setVolumeMock: vi.fn(),
    setMuteMock: vi.fn(),
    // Stand-ins for the reactive breakpoints; the store only ever reads `.value`.
    viewport: { content_width: { value: 1200 }, isMobile: { value: false } },
}))

// The settings store drags in requests, the router and device sync. None of it
// matters for the volume actions.
vi.mock('@/requests/plugins', () => ({ pluginSetActive: vi.fn(), updatePluginSettings: vi.fn() }))
vi.mock('@/requests/settings', () => ({ updateConfig: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: vi.fn() }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/player', () => ({
    usePlayer: () => ({ setVolume: setVolumeMock, setMute: setMuteMock }),
}))
vi.mock('@/context_menus/hashing', () => ({ getLastFmApiSig: vi.fn() }))
vi.mock('@/stores/content-width', () => viewport)
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))

import useSettings from '@/stores/settings'

/** What the user actually cares about: can this state make a sound? */
function isAudible(settings: ReturnType<typeof useSettings>) {
    return !settings.mute && settings.volume > 0
}

describe('settings store: the speaker button toggles audibility', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        setVolumeMock.mockReset()
        setMuteMock.mockReset()
        viewport.isMobile.value = false
    })

    it('mutes a normally playing setup', () => {
        const settings = useSettings()
        settings.setVolume(0.6)

        settings.toggleMute()

        expect(settings.mute).toBe(true)
        expect(isAudible(settings)).toBe(false)
        expect(setMuteMock).toHaveBeenLastCalledWith(true)
    })

    it('un-mutes back to the level it was at', () => {
        const settings = useSettings()
        settings.setVolume(0.6)

        settings.toggleMute()
        settings.toggleMute()

        expect(settings.mute).toBe(false)
        expect(settings.volume).toBe(0.6)
        expect(isAudible(settings)).toBe(true)
    })

    // THE BUG. Before the fix this left volume at 0 and stayed silent.
    it('recovers from volume 0 — the state a phone could not escape', () => {
        const settings = useSettings()
        settings.setVolume(0.8)
        settings.setVolume(0)

        expect(isAudible(settings)).toBe(false)

        settings.toggleMute()

        expect(isAudible(settings)).toBe(true)
        expect(settings.volume).toBe(0.8)
        expect(setVolumeMock).toHaveBeenLastCalledWith(0.8)
    })

    it('recovers from volume 0 AND muted at the same time', () => {
        const settings = useSettings()
        settings.setVolume(0.4)
        settings.toggleMute() // muted at 0.4
        settings.setVolume(0) // ...and then dragged to zero

        settings.toggleMute()

        expect(isAudible(settings)).toBe(true)
        expect(settings.volume).toBe(0.4)
    })

    it('falls back to full volume when there is no remembered level', () => {
        // A profile persisted at 0 before this fix existed has no
        // `last_audible_volume` worth returning to.
        const settings = useSettings()
        settings.volume = 0
        settings.last_audible_volume = 0

        settings.toggleMute()

        expect(settings.volume).toBe(1.0)
        expect(isAudible(settings)).toBe(true)
    })

    it('never remembers 0 as the level to come back to', () => {
        const settings = useSettings()
        settings.setVolume(0.5)
        settings.setVolume(0)

        expect(settings.last_audible_volume).toBe(0.5)
    })

    it('always alternates — no tap is ever a no-op', () => {
        const settings = useSettings()
        settings.setVolume(0)

        // Six taps from the worst starting point: silence, sound, silence, …
        const heard: boolean[] = []
        for (let i = 0; i < 6; i++) {
            settings.toggleMute()
            heard.push(isAudible(settings))
        }

        expect(heard).toEqual([true, false, true, false, true, false])
    })
})

/**
 * Startup on a phone (#320).
 *
 * The persisted silent state was a one-way door there: at phone width the
 * bottom bar swaps its whole right group for the navigation, so the only
 * speaker in the app sits far down the Now Playing page — measured headless,
 * a portrait viewport had ZERO reachable mute controls on every other page,
 * while the same phone in landscape (>900px) got the desktop bar and could
 * un-mute anywhere. Rotating the device was the fix. So a phone starts audible.
 */
describe('settings store: a phone never starts silent', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        setVolumeMock.mockReset()
        setMuteMock.mockReset()
        viewport.isMobile.value = true
    })

    it('drops a persisted mute at startup', () => {
        const settings = useSettings()
        settings.mute = true
        settings.volume = 0.6

        settings.initializeVolume()

        expect(isAudible(settings)).toBe(true)
        expect(settings.volume).toBe(0.6)
        expect(setMuteMock).toHaveBeenLastCalledWith(false)
    })

    it('comes back to the last audible level from a persisted 0', () => {
        const settings = useSettings()
        settings.volume = 0
        settings.last_audible_volume = 0.4

        settings.initializeVolume()

        expect(isAudible(settings)).toBe(true)
        expect(settings.volume).toBe(0.4)
        expect(setVolumeMock).toHaveBeenLastCalledWith(0.4)
    })

    it('falls back to full volume when nothing audible was ever remembered', () => {
        const settings = useSettings()
        settings.mute = true
        settings.volume = 0
        settings.last_audible_volume = 0

        settings.initializeVolume()

        expect(settings.volume).toBe(1.0)
        expect(isAudible(settings)).toBe(true)
    })

    it('leaves an audible phone exactly as it was', () => {
        const settings = useSettings()
        settings.volume = 0.3

        settings.initializeVolume()

        expect(settings.volume).toBe(0.3)
        expect(setVolumeMock).toHaveBeenLastCalledWith(0.3)
        expect(setMuteMock).toHaveBeenLastCalledWith(false)
    })

    it('leaves a desktop muted — there the speaker is on screen at all times', () => {
        viewport.isMobile.value = false

        const settings = useSettings()
        settings.mute = true
        settings.volume = 0.6

        settings.initializeVolume()

        expect(settings.mute).toBe(true)
        expect(setMuteMock).toHaveBeenLastCalledWith(true)
    })
})
