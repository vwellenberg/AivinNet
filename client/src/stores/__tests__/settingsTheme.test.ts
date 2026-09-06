import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { themeForNowMock } = vi.hoisted(() => ({ themeForNowMock: vi.fn(() => 'dark' as 'light' | 'dark') }))

vi.mock('@/utils/autoTheme', () => ({
    themeForNow: () => themeForNowMock(),
}))

// The settings store drags in requests, the router, the player and device sync.
// None of it matters for the theme actions.
vi.mock('@/requests/plugins', () => ({ pluginSetActive: vi.fn(), updatePluginSettings: vi.fn() }))
vi.mock('@/requests/settings', () => ({ updateConfig: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: vi.fn() }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/player', () => ({ usePlayer: () => ({ setVolume: vi.fn(), setMute: vi.fn() }) }))
vi.mock('@/context_menus/hashing', () => ({ getLastFmApiSig: vi.fn() }))
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))

import useSettings from '@/stores/settings'

describe('settings store: theme + auto dark mode', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        themeForNowMock.mockReset()
        themeForNowMock.mockReturnValue('dark')
    })

    it('starts on light with auto off', () => {
        const settings = useSettings()
        expect(settings.theme).toBe('light')
        expect(settings.auto_theme).toBe(false)
    })

    it('applyAutoTheme does nothing while auto is off', () => {
        const settings = useSettings()
        settings.applyAutoTheme()

        expect(settings.theme).toBe('light')
        expect(themeForNowMock).not.toHaveBeenCalled()
    })

    it('applyAutoTheme adopts the time-of-day theme once auto is on', () => {
        const settings = useSettings()
        settings.auto_theme = true

        settings.applyAutoTheme()

        expect(settings.theme).toBe('dark')
    })

    it('turning auto on applies the theme immediately', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()

        expect(settings.auto_theme).toBe(true)
        expect(settings.theme).toBe('dark')
    })

    it('re-checking switches back when the window is reached', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()
        expect(settings.theme).toBe('dark')

        themeForNowMock.mockReturnValue('light')
        settings.applyAutoTheme()

        expect(settings.theme).toBe('light')
    })

    it('toggling the theme by hand turns auto off', () => {
        // Otherwise the next check would snap the choice back and the toggle
        // would look broken.
        const settings = useSettings()
        settings.toggleAutoTheme()
        expect(settings.auto_theme).toBe(true)

        settings.toggleTheme()

        expect(settings.auto_theme).toBe(false)
        expect(settings.theme).toBe('light')
    })

    it('a manual choice then survives further checks', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()
        settings.toggleTheme()

        settings.applyAutoTheme()

        expect(settings.theme).toBe('light')
    })

    it('turning auto off leaves the current theme in place', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()
        expect(settings.theme).toBe('dark')

        settings.toggleAutoTheme()

        expect(settings.auto_theme).toBe(false)
        expect(settings.theme).toBe('dark')
    })

    it('setTheme does not disable auto (it is the settings-panel select)', () => {
        // The select is inactive while auto is on, so it should not carry the
        // toggle's side effect.
        const settings = useSettings()
        settings.auto_theme = true

        settings.setTheme('light')

        expect(settings.auto_theme).toBe(true)
    })
})
