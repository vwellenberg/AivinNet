import { Setting } from '@/interfaces/settings'
import settings from '@/stores/settings'
import { SettingType } from '../enums'
import type { ReplayGainMode } from '@/utils/replayGain'

const use_silence: Setting = {
    title: 'Silence padding removal',
    desc: 'Automatically skip silence between tracks',
    type: SettingType.binary,
    state: () => settings().use_silence_skip,
    action: () => settings().toggleUseSilenceSkip(),
}

const use_crossfade: Setting = {
    title: 'Enable crossfade',
    desc: 'Fade out the current track while fading in the next track',
    type: SettingType.binary,
    state: () => settings().use_crossfade,
    action: () => settings().toggleCrossfade(),
}

const crossfade: Setting = {
    title: 'Crossfade duration',
    desc: 'Duration of the crossfade in seconds',
    type: SettingType.locked_number_input,
    state: () => settings().crossfade_duration_seconds,
    action: (duration: number) => settings().setCrossfadeDuration(duration),
    defaultAction: () => {},
    show_if: () => settings().use_crossfade,
}

/**
 * ReplayGain (#643): even out the loudness between tracks from the gain the
 * files carry in their tags. Turning it on plays everything a little quieter,
 * so quiet tracks have room to catch up (utils/replayGain.ts).
 */
const replaygain: Setting = {
    title: 'Even out volume',
    desc: 'Uses the ReplayGain tags in your files. Track: every song at the same loudness. Album: whole albums level, songs within keep their differences. Plays a little quieter overall.',
    type: SettingType.select,
    options: [
        { title: 'Off', value: 'off' },
        { title: 'Track', value: 'track' },
        { title: 'Album', value: 'album' },
    ],
    state: () => settings().replaygain,
    action: (value: ReplayGainMode) => settings().setReplayGain(value),
}

export default [use_silence, use_crossfade, crossfade, replaygain]
