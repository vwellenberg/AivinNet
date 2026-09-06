import { loggedInUserIsAdmin } from '../utils'

import { SettingCategory } from '@/interfaces/settings'
import UsersSvg from '@/assets/icons/users.svg?raw'
import { SettingType } from '../enums'

export default <SettingCategory>{
    show_if: loggedInUserIsAdmin,
    groups: [
        {
            title: 'Accounts',
            icon: UsersSvg,
            settings: [
                {
                    type: SettingType.accounts,
                },
            ],
        },
    ],
}
