import { SettingCategory } from '@/interfaces/settings'

import LyricsSvg from '@/assets/icons/lyrics.svg?raw'

import { loggedInUserIsAdmin } from '../utils'
import lyrics from './lyrics'

// Last.fm is deliberately not here: it was taken out of the app in May 2026.
// The page itself went with it, which took the lyrics switch down too — the
// finder ships off, and there was no way left to turn it on (or off again).
export default <SettingCategory>{
    title: 'Plugins',
    show_if: loggedInUserIsAdmin,
    groups: [
        {
            title: 'Lyrics',
            icon: LyricsSvg,
            desc: 'Look up missing lyrics on Musixmatch. Sends the title and artist of the track you are viewing.',
            settings: lyrics,
        },
    ],
}
