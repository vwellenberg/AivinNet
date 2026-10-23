import { SettingCategory } from '@/interfaces/settings'
import HomeSvg from '@/assets/icons/home.svg?raw'
import { SettingType } from './enums'
import { loggedInUserIsGuest } from './utils'

// Per user, on the server (GET/PUT /nothome/layout, #532): every account has
// its own Home, so every account gets this page — except the guest account,
// which all guests share and which keeps the default Home.
export default <SettingCategory>{
    show_if: () => !loggedInUserIsGuest(),
    groups: [
        {
            title: 'Home',
            desc: 'Show, hide and order the rows on Home.',
            icon: HomeSvg,
            settings: [
                {
                    type: SettingType.home_rows,
                },
            ],
        },
    ],
}
