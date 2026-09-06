import { SettingType } from '../enums'
import { Setting } from '@/interfaces/settings'

import useSettingsStore from '@/stores/settings'

const settings = useSettingsStore

/**
 * The cover-tinted veil the detail pages paint over the grid ground. Off means
 * the bare grid paper everywhere. Applied centrally in
 * utils/colortools/pageGradient.ts, so this one switch covers album, artist and
 * playlist pages alike.
 */
const page_gradient: Setting = {
    title: 'Cover-tinted page gradient',
    desc: 'Tint the top of album, artist and playlist pages with the cover colour. Off shows the plain grid ground.',
    type: SettingType.binary,
    state: () => settings().use_page_gradient,
    action: () => settings().togglePageGradient(),
}

export default [page_gradient]
