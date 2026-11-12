import useSettings from '@/stores/settings'
import { loggedInUserIsAdmin } from '../utils'

import { SettingCategory } from '@/interfaces/settings'
import * as strings from '../strings'
import albums, { write_cover_to_files as writeCoverToFiles } from './albums'
import restore from './backup'
import font from './font'
import { checkLibrary, fetchMissingCoversRow } from './musicbrainz'
import nowPlaying from './now-playing-group'
import onlineMetadata from './online-metadata'
import pageGradient from './page-gradient'
import ratings from './ratings'
import rootDirSettings from './root-dirs'
import separators from './separators'
import sidebarSettings from './sidebar'
import theme from './theme'
import tileSize from './tile-size'
import tracks from './tracks'
// icons
import AlbumSvg from '@/assets/icons/album.svg?raw'
import ArtistSvg from '@/assets/icons/artist.svg?raw'
import BackupSvg from '@/assets/icons/backup.svg?raw'
import CoverSvg from '@/assets/icons/cover.svg?raw'
import FolderSvg from '@/assets/icons/folder.svg?raw'
import TrackSvg from '@/assets/icons/note.svg?raw'
// The star, not the heart: the heart is the favourite in this app (#777).
import RatingSvg from '@/assets/icons/star.svg?raw'
import AppearanceSvg from '@/assets/icons/paintbrush.svg?raw'
import LayoutSvg from '@/assets/icons/layout.svg?raw'

const npStrings = strings.nowPlayingStrings
const rootRootStrings = strings.manageRootDirsStrings

export const general = {
    // title: 'General',
    groups: [
        {
            title: 'Appearance',
            desc: 'Light or dark, theme, colours and font.',
            icon: AppearanceSvg,
            settings: [...theme, ...font],
        },
        {
            // What sits where and how big: split off Appearance, which had grown
            // to fourteen rows with dark mode somewhere in the middle.
            title: 'Layout',
            desc: 'Tile size, the sidebar, and what pages and Now Playing show.',
            icon: LayoutSvg,
            settings: [...tileSize, ...pageGradient, ...nowPlaying, ...sidebarSettings],
        },
    ],
} as SettingCategory

export const library = {
    title: 'Library',
    show_if: loggedInUserIsAdmin,
    groups: [
        {
            title: "Folders",
            icon: FolderSvg,
            desc: rootRootStrings.desc,
            settings: [...rootDirSettings],
        },
        {
            // null means settings table is not created yet
            show_if: () => useSettings().feat !== null,
            title: 'Tracks',
            icon: TrackSvg,
            desc: 'Settings relating to track information',
            settings: [...tracks],
        },
        {
            // null means settings table is not created yet
            show_if: () => useSettings().feat !== null,
            title: 'Albums',
            icon: AlbumSvg,
            desc: 'How albums are put together, and a check for albums whose tags look broken',
            settings: [...albums, checkLibrary],
        },
        {
            // null means settings table is not created yet
            show_if: () => useSettings().feat !== null,
            title: 'Artists',
            icon: ArtistSvg,
            desc: 'Artist separators, and artist data from the internet',
            settings: [separators, ...onlineMetadata],
        },
        {
            show_if: () => useSettings().feat !== null,
            title: 'Covers',
            icon: CoverSvg,
            desc: 'Fetch missing album covers, and whether a new cover goes into the files',
            settings: [fetchMissingCoversRow, writeCoverToFiles],
        },
        {
            show_if: () => useSettings().feat !== null,
            title: 'Ratings',
            icon: RatingSvg,
            desc: 'Your 1 to 5 star ratings, and how they reach the audio files',
            settings: [...ratings],
        },
        {
            title: "Backup",
            icon: BackupSvg,
            desc: "Backup and restore your settings",
            settings: [...restore],
        }
    ],
} as SettingCategory

// ENHANCEMENT: Decouple components from Group.vue and pass them as part of the Setting interface (maybe?)
