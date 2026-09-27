import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { themeForNowMock } = vi.hoisted(() => ({ themeForNowMock: vi.fn((..._args: unknown[]) => 'dark' as 'light' | 'dark') }))

vi.mock('@/utils/autoTheme', async () => ({
    ...(await vi.importActual<typeof import('@/utils/autoTheme')>('@/utils/autoTheme')),
    themeForNow: (...args: unknown[]) => themeForNowMock(...args),
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

    it('starts on the Memphis look', () => {
        expect(useSettings().look).toBe('memphis')
    })

    it('switching the look leaves mode and auto alone', () => {
        // Stream is dark only, but it must not overwrite the mode: the user's
        // light/dark choice comes back unchanged on switching back.
        const settings = useSettings()
        settings.toggleAutoTheme()
        expect(settings.theme).toBe('dark')

        settings.setLook('stream')
        expect(settings.theme).toBe('dark')
        expect(settings.auto_theme).toBe(true)

        settings.setLook('memphis')
        expect(settings.theme).toBe('dark')
        expect(settings.auto_theme).toBe(true)
    })

    it('auto keeps following the day under Stream, ready for the switch back', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()
        settings.setLook('stream')

        themeForNowMock.mockReturnValue('light')
        settings.applyAutoTheme()

        expect(settings.theme).toBe('light')
        expect(settings.look).toBe('stream')
    })

    it('defaults the schedule to the device zone, 08:00 -> 20:00', () => {
        const settings = useSettings()
        expect(settings.auto_theme_zone).toBe('device')
        expect(settings.auto_theme_light_from).toBe(8)
        expect(settings.auto_theme_dark_from).toBe(20)
    })

    it('hands zone and hours to the time check', () => {
        const settings = useSettings()
        settings.auto_theme = true
        settings.auto_theme_zone = 'Asia/Tokyo'
        settings.auto_theme_light_from = 6
        settings.auto_theme_dark_from = 22

        settings.applyAutoTheme()

        expect(themeForNowMock).toHaveBeenCalledWith(expect.any(Date), {
            timeZone: 'Asia/Tokyo',
            lightFrom: 6,
            darkFrom: 22,
        })
    })

    it('changing the schedule re-applies at once while auto is on', () => {
        const settings = useSettings()
        settings.toggleAutoTheme()
        themeForNowMock.mockReturnValue('light')

        settings.setAutoThemeDarkFrom(23)
        expect(settings.auto_theme_dark_from).toBe(23)
        expect(settings.theme).toBe('light')

        themeForNowMock.mockReturnValue('dark')
        settings.setAutoThemeZone('Asia/Tokyo')
        expect(settings.auto_theme_zone).toBe('Asia/Tokyo')
        expect(settings.theme).toBe('dark')

        themeForNowMock.mockReturnValue('light')
        settings.setAutoThemeLightFrom(5)
        expect(settings.auto_theme_light_from).toBe(5)
        expect(settings.theme).toBe('light')
    })

    it('changing the schedule while auto is off stores it but leaves the theme', () => {
        const settings = useSettings()
        settings.setAutoThemeLightFrom(6)

        expect(settings.auto_theme_light_from).toBe(6)
        expect(settings.theme).toBe('light')
        expect(themeForNowMock).not.toHaveBeenCalled()
    })

    it('clamps an out-of-range hour instead of storing it', () => {
        const settings = useSettings()
        settings.setAutoThemeDarkFrom(25)
        expect(settings.auto_theme_dark_from).toBe(1)
    })

    it('an unknown zone is stored as device, not shown-but-ignored', () => {
        const settings = useSettings()
        settings.setAutoThemeZone('Mars/Olympus_Mons')
        expect(settings.auto_theme_zone).toBe('device')

        settings.setAutoThemeZone('Asia/Tokyo')
        expect(settings.auto_theme_zone).toBe('Asia/Tokyo')
    })
})
