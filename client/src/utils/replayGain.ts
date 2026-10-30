/**
 * ReplayGain (#643): even out the loudness between tracks from the gain the
 * files carry in their tags. The server passes those tags through in
 * `track.extra` as tinytag reads them: lists of strings, keys in lower case.
 *
 * - `replaygain_track_gain` / `replaygain_album_gain`: "-6.54 dB", relative to
 *   the ReplayGain reference (-18 LUFS).
 * - `r128_track_gain` / `r128_album_gain` (Opus): an integer in 1/256 dB,
 *   relative to -23 LUFS, so 5 dB quieter than the ReplayGain reference.
 *
 * The player can only turn a track DOWN (`audio.volume` stops at 1; boosting
 * would mean routing the audio through Web Audio, which iOS suspends when the
 * screen locks). So everything is aimed `HEADROOM_DB` below the reference:
 * loud masters come down to that level, and quiet ones have that much room to
 * catch up before they hit the ceiling.
 */

export type ReplayGainMode = 'off' | 'track' | 'album'

export const REPLAYGAIN_MODES: readonly ReplayGainMode[] = ['off', 'track', 'album']

/** How far below the ReplayGain reference everything plays. */
export const HEADROOM_DB = -6

/** Opus R128 gains are relative to -23 LUFS, ReplayGain to -18 LUFS. */
const R128_TO_REPLAYGAIN_DB = 5

function firstValue(value: unknown): string | null {
    const v = Array.isArray(value) ? value[0] : value
    if (v === undefined || v === null) return null
    const s = String(v).trim()
    return s === '' ? null : s
}

/** "-6.54 dB" → -6.54; anything unreadable → null. */
export function parseGainDb(value: unknown): number | null {
    const s = firstValue(value)
    if (s === null) return null
    const match = s.replace(',', '.').match(/^([+-]?\d+(?:\.\d+)?)\s*(?:db)?$/i)
    if (!match) return null
    const db = Number(match[1])
    // A real gain stays within a few dozen dB; anything else is a broken tag.
    return Number.isFinite(db) && Math.abs(db) <= 60 ? db : null
}

/** An Opus R128 gain ("-1792", 1/256 dB at -23 LUFS) in ReplayGain dB. */
export function parseR128Db(value: unknown): number | null {
    const s = firstValue(value)
    if (s === null || !/^[+-]?\d+$/.test(s)) return null
    const db = Number(s) / 256 + R128_TO_REPLAYGAIN_DB
    return Math.abs(db) <= 60 ? db : null
}

/**
 * The gain a track's tags ask for in this mode, in dB, or null when there is
 * none. Album mode falls back to the track gain: a single in an album of one
 * often carries only that.
 */
export function gainDb(extra: Record<string, unknown> | undefined | null, mode: ReplayGainMode): number | null {
    if (!extra || mode === 'off') return null
    const track = parseGainDb(extra.replaygain_track_gain) ?? parseR128Db(extra.r128_track_gain)
    if (mode === 'track') return track
    const album = parseGainDb(extra.replaygain_album_gain) ?? parseR128Db(extra.r128_album_gain)
    return album ?? track
}

/**
 * The factor to multiply the volume with: 1 when off; otherwise the tagged
 * gain plus the headroom, never above 1.
 *
 * An untagged track gets the headroom alone, as if it sat at the reference.
 * Leaving it at 1 would make every untagged track jump 6 dB above its
 * levelled neighbours; this way switching the mode on turns everything down
 * by the same step and then evens out what the tags allow.
 */
export function replayGainFactor(
    extra: Record<string, unknown> | undefined | null,
    mode: ReplayGainMode,
): number {
    if (mode === 'off') return 1
    const db = gainDb(extra, mode) ?? 0
    return Math.min(1, Math.pow(10, (db + HEADROOM_DB) / 20))
}
