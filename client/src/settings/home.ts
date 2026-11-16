import { SettingCategory } from '@/interfaces/settings'
import HomeSvg from '@/assets/icons/home.svg?raw'
import { SettingType } from './enums'
import { loggedInUserIsGuest } from './utils'
import useSettings from '@/stores/settings'

// The rows are per user, on the server (GET/PUT /nothome/layout, #532): every
// account has its own Home, so every account can order them — except the guest
// account, which all guests share and which keeps the default rows. The
// AivinNet FM switch is per device (local), so the guest gets it too.
const ownAccount = () => !loggedInUserIsGuest()

export default <SettingCategory>{
    groups: [
        {
            title: 'Home',
            desc: 'Show, hide and order the rows on Home.',
            icon: HomeSvg,
            settings: [
                // Not a row: the dial sits at a fixed place above them, and
                // the switch is per device like its folded state (user,
                // 2026-11-16: off until someone turns it on).
                {
                    title: 'AivinNet FM',
                    desc: 'Show the radio dial on Home, on this device.',
                    type: SettingType.binary,
                    state: () => useSettings().show_radio,
                    action: () => useSettings().toggleShowRadio(),
                },
                {
                    type: SettingType.home_rows,
                    show_if: ownAccount,
                },
                {
                    type: SettingType.home_not_interested,
                    show_if: ownAccount,
                    title: 'Not interested',
                    desc: 'What you hid from Never played and Artists you might like.',
                },
            ],
        },
    ],
}
