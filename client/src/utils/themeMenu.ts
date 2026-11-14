import { CheckIcon } from '@/icons'
import type { Option } from '@/interfaces'

/** The slice of the settings store the theme menu reads and drives. */
export interface ThemeMenuSettings {
    theme: 'light' | 'dark'
    auto_theme: boolean
    setThemeManually(theme: 'light' | 'dark'): void
    toggleAutoTheme(): void
}

/**
 * Options for the theme toggle's long-press / right-click menu.
 *
 * Light and Dark are manual choices, so they take Auto off. Auto only turns on:
 * `toggleAutoTheme()` would switch it off again when it is already on. The
 * active choice carries the check icon. `Schedule…` opens Settings, where the
 * auto-theme hours live.
 */
export function themeMenuOptions(settings: ThemeMenuSettings, openSettings: () => void): Option[] {
    const active = settings.auto_theme ? 'auto' : settings.theme
    const icon = (choice: 'auto' | 'light' | 'dark') => (active === choice ? CheckIcon : undefined)

    return [
        { label: 'Light', icon: icon('light'), action: () => settings.setThemeManually('light') },
        { label: 'Dark', icon: icon('dark'), action: () => settings.setThemeManually('dark') },
        {
            label: 'Auto',
            icon: icon('auto'),
            action: () => {
                if (!settings.auto_theme) settings.toggleAutoTheme()
            },
        },
        { type: 'separator' },
        { label: 'Schedule…', action: () => openSettings() },
    ]
}
