import { SettingType } from '../enums'
import { Setting } from '@/interfaces/settings'

import useSettingsStore from '@/stores/settings'
import { lookHasModes, type Look } from '@/utils/theme'

const settings = useSettingsStore

/**
 * The LOOK: the app's form language. A separate setting from the mode below —
 * see utils/theme.ts for why the two are not one list.
 */
const look: Setting = {
    title: 'Theme',
    desc: 'Memphis: grid paper, ink frames and hard shadows. Stream: flat and dark. Desktop 98: grey windows on a blue desktop. Virtual Grid: dark glass over a neon grid.',
    type: SettingType.select,
    options: [
        { title: 'Memphis', value: 'memphis' },
        { title: 'Stream', value: 'stream' },
        { title: 'Desktop 98', value: 'desktop98' },
        { title: 'Virtual Grid', value: 'virtualgrid' },
    ],
    state: () => settings().look,
    action: (value: Look) => settings().setLook(value),
}

/**
 * The MODE: light or dark. App.vue turns look + mode into body classes
 * (utils/theme.ts), which flip the --mem-* custom properties
 * (Global/index.scss).
 */
const theme: Setting = {
    title: 'Mode',
    desc: 'Light grid paper or the near-black dark ground. Stream and Virtual Grid are always dark, Desktop 98 always light.',
    type: SettingType.select,
    options: [
        { title: 'Light', value: 'light' },
        { title: 'Dark', value: 'dark' },
    ],
    state: () => settings().theme,
    action: (value: 'light' | 'dark') => settings().setTheme(value),
    defaultAction: () => settings().toggleTheme(),
    // While Auto dark mode is on the mode is not the user's to pick — showing it
    // as editable would just let them make a choice the next check overrides.
    // Under a look with one mode there is nothing to pick either; the stored
    // choice waits for the switch back.
    inactive: () => settings().auto_theme || !lookHasModes(settings().look),
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
    inactive: () => !lookHasModes(settings().look),
}

export default [look, theme, auto_theme]
