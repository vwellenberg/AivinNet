import { Setting } from '@/interfaces/settings'
import useModal from '@/stores/modal'
import useMusicBrainzStore from '@/stores/musicbrainz'
import { SettingType } from '../enums'

const store = () => useMusicBrainzStore()

const fetchMissingCovers: Setting = {
    title: 'Fetch missing covers online',
    desc: 'Searches MusicBrainz, then the iTunes and Deezer stores (~1s per album). Albums whose tags cannot be verified are skipped rather than guessed at.',
    type: SettingType.button,
    state: null,
    inactive: () => store().isRunning || store().starting,
    button_text: () => {
        const s = store()
        if (s.starting) return 'Starting…'
        if (s.isRunning) return `Loading… ${s.progressPct}%`
        if (!s.countLoaded) {
            // Lazy-load the count the first time the setting renders.
            s.refreshCount()
            return 'Loading count…'
        }
        if (s.missingCount === 0) {
            return 'All covers present ✓'
        }
        if (s.remainingCount === 0) {
            return s.failedCount > 0
                ? `${s.failedCount} without match · retry`
                : 'Retry'
        }
        return `Load ${s.remainingCount} covers`
    },
    // limit 0 = all missing albums. When nothing is left to try (all
    // remaining were previously failed), the click retries those instead.
    action: () => {
        const s = store()
        s.startBatch(0, s.countLoaded && s.remainingCount === 0 && s.missingCount > 0)
    },
}

// The list is worked out on the server from the library as it stands, so it is
// current after every scan; the button only opens it.
const checkLibrary: Setting = {
    title: 'Check library for broken tags',
    desc: 'Lists albums that fell apart into several, have a track number as their artist, or placeholder titles. Nothing is changed until you choose to.',
    type: SettingType.button,
    state: null,
    button_text: () => 'Check',
    action: () => useModal().showLibraryAuditModal(),
}

export default [fetchMissingCovers, checkLibrary]
