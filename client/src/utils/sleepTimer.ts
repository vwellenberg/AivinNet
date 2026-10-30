/**
 * Sleep timer rules, without the store: what the choices are, how loud the
 * music is during the fade, and whether a track boundary ends playback.
 *
 * "End of song" and "end of album" are not clocks. They end playback at the
 * next AUTOMATIC track change: the track that is playing when it runs out is
 * the one that finishes. A manual skip does not cancel them.
 */

import type { Track } from '@/interfaces'

export type SleepChoice = { kind: 'minutes'; minutes: number } | { kind: 'song' } | { kind: 'album' }

export const SLEEP_MINUTES = [15, 30, 45, 60] as const

/** How long the music takes to fade out once the clock runs out. */
export const FADE_MS = 20_000

/**
 * The music's gain during the fade: 1 when it starts, 0 when it is over.
 * Linear in the gain, which is what `setDuck` takes.
 */
export function fadeGain(elapsedMs: number, fadeMs: number = FADE_MS): number {
    if (!(elapsedMs > 0)) return 1
    if (elapsedMs >= fadeMs) return 0
    return 1 - elapsedMs / fadeMs
}

/**
 * Whether playback has to stop before `next` starts, given the track that just
 * finished (`current`). Only the two track-bound choices answer here; minute
 * timers end through the clock and the fade instead.
 */
export function stopsBeforeTrack(
    choice: SleepChoice | null,
    current: Track | undefined,
    next: Track | undefined
): boolean {
    if (!choice) return false
    if (choice.kind === 'song') return true
    if (choice.kind === 'album') return next !== undefined && current?.albumhash !== next.albumhash
    return false
}

/** Short label for the indicator: "23 min", rounded up so it never reads 0. */
export function formatRemaining(remainingMs: number): string {
    const minutes = Math.max(1, Math.ceil(remainingMs / 60_000))
    return `${minutes} min`
}
