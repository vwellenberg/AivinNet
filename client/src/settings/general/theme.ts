import { SettingType } from '../enums'
import { Setting } from '@/interfaces/settings'

import useSettingsStore from '@/stores/settings'
import { availableTimeZones, deviceTimeZone, DEVICE_TIME_ZONE, formatHour } from '@/utils/autoTheme'
import { lookHasModes, type Look } from '@/utils/theme'

const settings = useSettingsStore

/**
 * The LOOK: the app's form language. A separate setting from the mode below —
 * see utils/theme.ts for why the two are not one list.
 */
const look: Setting = {
    title: 'Theme',
    desc: 'Memphis: grid paper, ink frames and hard shadows. Boring: flat and dark.',
    type: SettingType.select,
    options: [
        { title: 'Memphis', value: 'memphis' },
        // Shown as "Boring"; the stored value stays `stream` (#199), so a
        // saved choice survives the rename.
        { title: 'Boring', value: 'stream' },
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
    desc: 'Light grid paper or the near-black dark ground. Boring is always dark.',
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
 * Follows a time zone — the device's own by default, or one pinned below. See
 * utils/autoTheme.ts.
 */
const auto_theme: Setting = {
    title: 'Auto dark mode',
    desc: 'Follow the time of day: light during the hours below, dark otherwise. Checked on load and while the app is open. Switching the theme by hand turns this off.',
    type: SettingType.binary,
    state: () => settings().auto_theme,
    action: () => settings().toggleAutoTheme(),
    inactive: () => !lookHasModes(settings().look),
}

// The schedule rows only show while Auto is on: with it off they would be
// knobs that do nothing.
const autoOn = () => settings().auto_theme
const autoInactive = () => !lookHasModes(settings().look)
// Clicking a row's label runs `defaultAction`, else `action()` with NO value —
// for these rows that would store `undefined` as zone or hour. A dropdown has
// nothing sensible to cycle to, so the label click does nothing.
const noop = () => {}

const hourOptions = Array.from({ length: 24 }, (_, h) => ({ title: formatHour(h), value: h }))

function zoneOptions() {
    const zones = availableTimeZones()
    const stored = settings().auto_theme_zone
    // The store only ever holds 'device' or a zone Intl accepts (restore and
    // setter normalise it). One that Intl accepts but does not list — an alias
    // like 'US/Eastern' — still shows as selected instead of the dropdown
    // jumping to the first entry.
    if (typeof stored === 'string' && stored !== DEVICE_TIME_ZONE && !zones.includes(stored)) zones.unshift(stored)

    return [
        { title: `This device (${deviceTimeZone()})`, value: DEVICE_TIME_ZONE },
        ...zones.map(z => ({ title: z.replace(/_/g, ' '), value: z })),
    ]
}

const auto_theme_zone: Setting = {
    title: 'Time zone',
    desc: 'Whose clock decides day and night. "This device" follows the zone the browser runs in; pick a zone to keep home time on a machine set to another one.',
    type: SettingType.dropdown,
    get options() {
        return zoneOptions()
    },
    state: () => settings().auto_theme_zone,
    action: (zone: string) => settings().setAutoThemeZone(zone),
    show_if: autoOn,
    defaultAction: noop,
    inactive: autoInactive,
}

const auto_theme_light_from: Setting = {
    title: 'Light from',
    type: SettingType.dropdown,
    options: hourOptions,
    state: () => settings().auto_theme_light_from,
    action: (hour: number) => settings().setAutoThemeLightFrom(hour),
    show_if: autoOn,
    defaultAction: noop,
    inactive: autoInactive,
}

const auto_theme_dark_from: Setting = {
    title: 'Dark from',
    desc: 'May be earlier than "Light from" for a window across midnight. The same hour for both means always dark.',
    type: SettingType.dropdown,
    options: hourOptions,
    state: () => settings().auto_theme_dark_from,
    action: (hour: number) => settings().setAutoThemeDarkFrom(hour),
    show_if: autoOn,
    defaultAction: noop,
    inactive: autoInactive,
}

export default [look, theme, auto_theme, auto_theme_zone, auto_theme_light_from, auto_theme_dark_from]
