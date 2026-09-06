import { paths } from '@/config'
import type { Track } from '@/interfaces'
import type { DeviceSummary, PollResponse, SyncCommandType, SyncFrom } from '@/utils/deviceSync/types'
import useAxios from './useAxios'

const api = paths.api.devicesync

export interface PollBody {
    device_id: string
    known_version: number
    client_sent_ms: number
    volume: number
    mute: boolean
}

export interface CommandBody {
    device_id: string
    type: SyncCommandType
    payload: unknown
    target_device?: string
}

export interface SetQueueBody {
    device_id: string
    trackhashes: string[]
    from: SyncFrom
    currentindex: number
    playing: boolean
    position_ms: number
    repeat: string
}

/** Register (or refresh) this device in the persistent device registry. */
export async function registerDevice(deviceId: string, name: string, type: string) {
    return await useAxios({
        url: api.register,
        method: 'POST',
        props: { device_id: deviceId, name, type },
    })
}

/** Short-poll the group session; returns the parsed response or null on failure. */
export async function pollSession(body: PollBody): Promise<PollResponse | null> {
    const { data, status } = await useAxios({ url: api.poll, method: 'POST', props: body })
    return status === 200 ? (data as PollResponse) : null
}

/** Enqueue a transport or targeted command. */
export async function sendCommand(body: CommandBody) {
    return await useAxios({ url: api.command, method: 'POST', props: body })
}

/** Replace the group queue (seeds a fresh session on first join). */
export async function setQueue(body: SetQueueBody) {
    return await useAxios({ url: api.queueSet, method: 'POST', props: body })
}

/** Resolve trackhashes to full serialized tracks; returns [] on failure. */
export async function resolveTracks(trackhashes: string[]): Promise<Track[]> {
    const { data, status } = await useAxios({ url: api.resolve, method: 'POST', props: { trackhashes } })

    if (status !== 200) {
        return []
    }

    if (Array.isArray(data)) {
        return data as Track[]
    }

    if (Array.isArray(data?.tracks)) {
        return data.tracks as Track[]
    }

    return []
}

/** Join the current user's group session. */
export async function joinGroup(deviceId: string) {
    return await useAxios({ url: api.join, method: 'POST', props: { device_id: deviceId } })
}

/** Leave the group session (falls back to solo playback). */
export async function leaveGroup(deviceId: string) {
    return await useAxios({ url: api.leave, method: 'POST', props: { device_id: deviceId } })
}

// Re-exported for convenience so callers can name the device-list type without
// reaching into the types module directly.
export type { DeviceSummary }
