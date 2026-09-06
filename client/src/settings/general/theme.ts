import { SettingType } from '../enums'
import { Setting } from '@/interfaces/settings'

import useSettingsStore from '@/stores/settings'

const settings = useSettingsStore

/**
 * Memphis theme switch: grid-paper light vs. classic-90s indigo dark.
 * App.vue watches the store value and toggles `body.theme-dark`, which
 * flips the --mem-* custom properties (Global/index.scss).
 */
const theme: Setting = {
    title: 'Theme',
    desc: 'Grid-paper light or the near-black dark look.',
    type: SettingType.select,
    options: [
        { title: 'Light', value: 'light' },
        { title: 'Dark', value: 'dark' },
    ],
    state: () => settings().theme,
    action: (value: 'light' | 'dark') => settings().setTheme(value),
    defaultAction: () => settings().toggleTheme(),
    // While Auto dark mode is on the theme is not the user's to pick — showing it
    // as editable would just let them make a choice the next check overrides.
    inactive: () => settings().auto_theme,
}

/**
 * Berlin time on purpose, not the device's zone: the app is reached from several
 * machines (and from outside via Tailscale), and "day" should mean the same hours
 * on all of them. See utils/autoTheme.ts.
 */
const auto_theme: Setting = {
    title: 'Auto dark mode',
    desc: 'Follow the time of day in Berlin: light from 08:00 to 20:00, dark otherwise. Checked on load and while the app is open. Switching the theme by hand turns this off.',
    type: SettingType.binary,
    state: () => settings().auto_theme,
    action: () => settings().toggleAutoTheme(),
}

export default [theme, auto_theme]
