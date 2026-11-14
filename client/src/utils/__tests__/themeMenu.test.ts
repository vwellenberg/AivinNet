import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { themeForNowMock } = vi.hoisted(() => ({ themeForNowMock: vi.fn((..._args: unknown[]) => 'dark' as 'light' | 'dark') }))

vi.mock('@/utils/autoTheme', async () => ({
    ...(await vi.importActual<typeof import('@/utils/autoTheme')>('@/utils/autoTheme')),
    themeForNow: (...args: unknown[]) => themeForNowMock(...args),
}))

// The settings store drags in requests, the router, the player and device sync.
// None of it matters for the theme menu.
vi.mock('@/requests/plugins', () => ({ pluginSetActive: vi.fn(), updatePluginSettings: vi.fn() }))
vi.mock('@/requests/settings', () => ({ updateConfig: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: vi.fn() }))
vi.mock('@/stores/devicesync', () => ({ default: () => ({ joined: false, applying: false, intercept: vi.fn() }) }))
vi.mock('@/stores/player', () => ({ usePlayer: () => ({ setVolume: vi.fn(), setMute: vi.fn() }) }))
vi.mock('@/context_menus/hashing', () => ({ getLastFmApiSig: vi.fn() }))
vi.mock('@/router', () => ({ router: { currentRoute: { value: { name: 'other' } } }, Routes: {} }))

import { CheckIcon } from '@/icons'
import useSettings from '@/stores/settings'
import { themeMenuOptions } from '@/utils/themeMenu'

const TOGGLE_SOURCE = import.meta.glob('/src/components/nav/ThemeToggle.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>

describe('theme toggle menu', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        themeForNowMock.mockReset()
        themeForNowMock.mockReturnValue('dark')
    })

    function menu(openSettings = vi.fn()) {
        const settings = useSettings()
        return { settings, options: themeMenuOptions(settings, openSettings), openSettings }
    }

    function labelsOf(options: ReturnType<typeof themeMenuOptions>) {
        return options.map((o) => o.label ?? o.type)
    }

    function checked(options: ReturnType<typeof themeMenuOptions>) {
        return options.filter((o) => o.icon === CheckIcon).map((o) => o.label)
    }

    it('lists Light, Dark, Auto, a separator, then Schedule', () => {
        const { options } = menu()
        expect(labelsOf(options)).toEqual(['Light', 'Dark', 'Auto', 'separator', 'Schedule…'])
        expect(options[3].type).toBe('separator')
    })

    it('checks Light alone when the theme is light and auto is off', () => {
        const { settings, options } = menu()
        expect(settings.theme).toBe('light')
        expect(checked(options)).toEqual(['Light'])
    })

    it('checks Dark alone when the theme is dark and auto is off', () => {
        const settings = useSettings()
        settings.setThemeManually('dark')
        expect(checked(themeMenuOptions(settings, vi.fn()))).toEqual(['Dark'])
    })

    it('checks Auto alone while auto is on, whatever the current theme', () => {
        const { settings } = menu()
        settings.toggleAutoTheme()
        expect(settings.theme).toBe('dark')
        expect(checked(themeMenuOptions(settings, vi.fn()))).toEqual(['Auto'])
    })

    it('Light sets light and turns auto off', () => {
        const { settings, options } = menu()
        settings.toggleAutoTheme()

        options[0].action?.()

        expect(settings.auto_theme).toBe(false)
        expect(settings.theme).toBe('light')
    })

    it('Dark sets dark and turns auto off', () => {
        const { settings, options } = menu()
        settings.toggleAutoTheme()

        options[1].action?.()

        expect(settings.auto_theme).toBe(false)
        expect(settings.theme).toBe('dark')
    })

    it('Auto turns auto on and applies the time-of-day theme', () => {
        const { settings, options } = menu()

        options[2].action?.()

        expect(settings.auto_theme).toBe(true)
        expect(settings.theme).toBe('dark')
    })

    it('Auto does not toggle auto off when it is already on', () => {
        const { settings, options } = menu()
        settings.toggleAutoTheme()
        expect(settings.auto_theme).toBe(true)

        options[2].action?.()

        expect(settings.auto_theme).toBe(true)
    })

    it('Schedule calls the openSettings callback and leaves the theme alone', () => {
        const openSettings = vi.fn()
        const { settings, options } = menu(openSettings)
        settings.toggleAutoTheme()

        options[4].action?.()

        expect(openSettings).toHaveBeenCalledTimes(1)
        expect(settings.auto_theme).toBe(true)
    })

    it('the theme toggle uses v-context-menu and not @contextmenu', () => {
        const source = Object.values(TOGGLE_SOURCE)[0]
        expect(source).toBeTruthy()
        expect(source).toContain('v-context-menu')
        expect(source).not.toContain('@contextmenu')
    })
})
