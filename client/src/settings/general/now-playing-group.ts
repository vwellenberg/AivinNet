import { SettingType } from '../enums'
import { Setting } from '@/interfaces/settings'

import useSettingsStore from '@/stores/settings'

const settings = useSettingsStore

const npLauflicht: Setting = {
    title: 'Now Playing glow',
    desc: 'Animated brand light around the Now Playing artwork (pink glow + running comet). Pick how intense it is.',
    type: SettingType.select,
    options: [
        { title: 'Off', value: 'off' },
        { title: 'Subtle', value: 'subtle' },
        { title: 'Normal', value: 'normal' },
    ],
    state: () => settings().np_lauflicht_level,
    action: (value: 'off' | 'subtle' | 'normal') => settings().setNpLauflichtLevel(value),
    defaultAction: () => settings().cycleNpLauflichtLevel(),
}

// The heart next to the duration appears on row hover in any case — that is not
// a setting, it is how a row offers its actions. This one says whether a track
// that IS favourited keeps its heart when the pointer leaves.
const highlightFavoriteTracks: Setting = {
    title: 'Highlight favorite tracks',
    desc: 'Keep the teal heart visible on favorited tracks instead of only on hover',
    type: SettingType.binary,
    state: () => settings()._highlightFavoriteTracks,
    action: () => settings().toggleHighlightFavoriteTracks(),
}

export default [npLauflicht, highlightFavoriteTracks]
