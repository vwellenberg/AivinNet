/**
 * Which speaker glyph a volume shows (#238).
 *
 * Four steps, the way every speaker icon set reads: crossed out when nothing
 * is heard, then one short tick, one arc, two arcs. There used to be only the
 * first three, split at 0.5 — so full volume looked exactly like 51%.
 *
 * Thirds, not halves: with three audible glyphs each one owns an equal share of
 * the slider, and 100% lands on the two-arc glyph.
 */
export type VolumeLevel = 'mute' | 'low' | 'mid' | 'high'

export function volumeLevel(volume: number, silent: boolean): VolumeLevel {
    if (silent || volume <= 0) return 'mute'
    if (volume <= 1 / 3) return 'low'
    if (volume <= 2 / 3) return 'mid'
    return 'high'
}
