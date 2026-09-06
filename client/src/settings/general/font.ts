import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'
import useSettings from '@/stores/settings'

const settings = useSettings

const font: Setting = {
    title: 'Font',
    desc: 'Choose between the default font and a Spotify-like font (Figtree).',
    type: SettingType.select,
    options: [
        { title: 'Default', value: 'default' },
        { title: 'Spotify style', value: 'spotify' },
    ],
    state: () => settings().font,
    action: (value: 'default' | 'spotify') => settings().setFont(value),
    defaultAction: () => settings().toggleFont(),
}

export default [font]
