import useAuth from '@/stores/auth'
import { SettingCategory } from '@/interfaces/settings'

import LastfmSvg from '@/assets/icons/lastfm.svg?raw'

import { loggedInUserIsAdmin } from '../utils'
import lastfm from './lastfm'

export default <SettingCategory>{
    title: 'Plugins',
    show_if: loggedInUserIsAdmin,
    groups: [
        {
            title: 'Last.fm',
            icon: LastfmSvg,
            desc: 'Last.fm integration',
            settings: lastfm,
        },
    ],
}
