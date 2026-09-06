import { Setting } from '@/interfaces/settings'
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

export default [fetchMissingCovers]
