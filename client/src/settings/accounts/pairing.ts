import { loggedInUserIsAdmin } from '../utils'

import { SettingCategory } from '@/interfaces/settings'
import PhoneSvg from '@/assets/icons/phone.svg?raw'
import { SettingType } from '../enums'

export default <SettingCategory>{
    groups: [
        {
            title: 'Pair device',
            icon: PhoneSvg,
            settings: [
                {
                    type: SettingType.pairing,
                },
            ],
        },
    ],
}
