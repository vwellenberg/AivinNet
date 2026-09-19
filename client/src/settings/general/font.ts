import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'
import useSettings from '@/stores/settings'
import type { UiFont } from '@/utils/uiFont'

const settings = useSettings

const font: Setting = {
    title: 'Font',
    desc: 'Choose between the default font (Space Grotesk) and Figtree.',
    type: SettingType.select,
    options: [
        { title: 'Default', value: 'default' },
        { title: 'Figtree', value: 'figtree' },
    ],
    state: () => settings().font,
    action: (value: UiFont) => settings().setFont(value),
    defaultAction: () => settings().toggleFont(),
}

export default [font]
