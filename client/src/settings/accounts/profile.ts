import { SettingCategory } from '@/interfaces/settings'
import ProfileSvg from '@/assets/icons/profile.svg?raw'
import { SettingType } from '../enums'

export default <SettingCategory>{
    groups: [
        {
            title: 'Profile',
            // The settings list shows the user's own picture instead, once one
            // is uploaded; this glyph stands in until then (and if it fails to
            // load) — not the generated gradient avatar, which read as a
            // placeholder nobody chose.
            icon: ProfileSvg,
            settings: [
                {
                    type: SettingType.profile,
                },
            ],
        },
    ],
}
