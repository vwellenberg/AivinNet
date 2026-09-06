// Wire-protocol types for the multiroom device-sync feature.
//
// These are shared by the (later) devicesync store, request wrappers and UI.
// This module is FOUNDATIONS ONLY — nothing outside the deviceSync feature
// imports it yet.

import type { From } from '@/stores/queue/tracklist'

// The client's existing queue-source descriptor, re-exported under a
// sync-specific alias so downstream code can depend on this module without
// reaching back into the queue store's typings directly.
export type SyncFrom = From
export type { From }

/**
 * A server-authored playback anchor: the queue position at a given server
 * clock time. Everything else (expected position, drift) derives from this.
 */
export interface SyncAnchor {
    position_ms: number
    at_server_ms: number
}

/**
 * The authoritative group-session state, sent by the server only on a
 * version bump. `from` is the server's wire form of the queue source
 * descriptor; the client maps it back onto its own `From` when applying.
 */
export interface SyncState {
    queue_id: string
    trackhashes: string[]
    from: unknown
    currentindex: number
    repeat: string
    playing: boolean
    anchor: SyncAnchor
}

export type SyncCommandType =
    | 'play'
    | 'pause'
    | 'seek'
    | 'track_change'
    | 'set_repeat'
    | 'set_volume'
    | 'set_mute'
    | 'join_invite'
    | 'play_here'

/**
 * A scheduled or targeted command. Transport commands carry a server-side
 * `execute_at_ms` and no target; targeted commands (volume/mute/invite/
 * play_here) carry a `target_device` and execute immediately.
 */
export interface SyncCommand {
    id: string
    type: SyncCommandType
    payload: unknown
    execute_at_ms: number
    target_device: string | null
}

export interface DeviceSummary {
    device_id: string
    name: string
    type: string
    online: boolean
    joined: boolean
    volume: number
    mute: boolean
    is_leader: boolean
}

/**
 * Response shape of `POST /devicesync/poll`. `state` is present only when the
 * client's `known_version` is behind the session `version`.
 */
export interface PollResponse {
    server_now_ms: number
    version: number
    joined: boolean
    scrobble_leader: string | null
    state?: SyncState
    commands: SyncCommand[]
    devices: DeviceSummary[]
}
