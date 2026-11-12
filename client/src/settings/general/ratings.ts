import { ref } from 'vue'

import { Setting } from '@/interfaces/settings'
import { SettingType } from '../enums'
import { importRatingsFromFiles } from '@/requests/rating'
import { NotifType } from '@/enums'

import useSettingsStore from '@/stores/settings'
import { useToast as notif } from '@/stores/notification'

const settings = useSettingsStore

// The one switch here that MODIFIES the audio files (config.py::writeRatingsToFiles).
// Off by default. Only one rating fits in a file, so with several users the last
// one to rate wins; the description says so instead of hiding it.
const write_ratings_to_files: Setting = {
    title: 'Write ratings into the files',
    desc: 'Writes each rating into the audio files, so other players see it. With several users, the last one to rate a track wins.',
    type: SettingType.binary,
    state: () => settings().write_ratings_to_files,
    action: () => settings().toggleWriteRatingsToFiles(),
}

// A ref, not a plain `let`: the settings page re-renders the button from it.
const importing = ref(false)

// Takes the ratings the files already carry into this account, where it has none.
// The report comes back as a notification: imported, skipped, unreadable.
const import_ratings: Setting = {
    title: 'Import ratings from the files',
    desc: 'Takes the ratings the files carry (from other players too) for this account. Existing ratings are kept.',
    type: SettingType.button,
    state: null,
    inactive: () => importing.value,
    button_text: () => (importing.value ? 'Importing…' : 'Import'),
    action: async () => {
        importing.value = true
        try {
            const { report, error } = await importRatingsFromFiles()
            if (error || !report) {
                notif().showNotification(error || 'The import failed', NotifType.Error)
                return
            }
            notif().showNotification(
                `Imported ${report.imported}, skipped ${report.skipped}, unreadable ${report.unreadable}`,
                report.unreadable > 0 ? NotifType.Info : NotifType.Success
            )
        } finally {
            importing.value = false
        }
    },
}

export default [write_ratings_to_files, import_ratings]
