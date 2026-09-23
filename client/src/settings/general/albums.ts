import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'

import useSettingsStore from '@/stores/settings'

const settings = useSettingsStore

const clean_album_titles: Setting = {
    title: 'Clean album titles',
    desc: 'Remove bracketed text from titles and process it separately if possible',
    type: SettingType.binary,
    state: () => settings().clean_titles,
    action: () => settings().toggleCleanAlbumTitle(),
}

const merge_album_versions: Setting = {
    title: 'Merge album versions',
    desc: 'All versions of the same album will be merged into one album',
    type: SettingType.binary,
    state: () => {
        const settings = useSettingsStore()
        return settings.clean_titles && settings.merge_albums
    },
    action: () => settings().toggleMergeAlbums(),
    inactive: () => !settings().clean_titles,
}

const show_albums_as_singles: Setting = {
    title: 'Mark albums with one track as singles',
    desc: 'Require an album to have at least two tracks',
    type: SettingType.binary,
    state: () => settings().show_albums_as_singles,
    action: () => settings().toggleShowAlbumsAsSingles(),
}

// The one setting that MODIFIES the user's files (config.py::writeCoverToFiles).
// On by default, but anyone whose tags are kept by another program must be able
// to say no — which needs a switch they can actually reach.
const write_cover_to_files: Setting = {
    title: 'Write changed covers into the files',
    desc: "Changing an album's cover also embeds it in the album's audio files, so other players show it too",
    type: SettingType.binary,
    state: () => settings().write_cover_to_files,
    action: () => settings().toggleWriteCoverToFiles(),
}

export default [clean_album_titles, merge_album_versions, show_albums_as_singles, write_cover_to_files]
