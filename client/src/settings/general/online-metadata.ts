import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'

import useSettingsStore from '@/stores/settings'

// Off by default, deliberately — see config.py::enableOnlineMetadata. It is the
// only switch that lets a scan talk to the internet on its own, so the
// description says exactly what leaves the machine.
const online_metadata: Setting = {
    title: 'Artist images and similar artists',
    desc: 'During a scan, send every artist name to Deezer (images) and Last.fm (similar artists). Applies from the next scan.',
    type: SettingType.binary,
    state: () => useSettingsStore().online_metadata,
    action: () => useSettingsStore().toggleOnlineMetadata(),
}

export default [online_metadata]
