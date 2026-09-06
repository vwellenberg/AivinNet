import type { SyncAnchor } from './types'

/**
 * The playback position (ms) a device *should* be at right now, given the
 * server anchor and the estimated server time. While playing, position
 * advances with the wall clock; while paused it is frozen at the anchor.
 * Clamped at 0 so a server time before the anchor never yields a negative.
 */
export function expectedPositionMs(anchor: SyncAnchor, serverNowMs: number, playing: boolean): number {
    const position = playing ? anchor.position_ms + (serverNowMs - anchor.at_server_ms) : anchor.position_ms
    return Math.max(0, position)
}
