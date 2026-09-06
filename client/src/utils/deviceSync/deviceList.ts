import type { DeviceSummary } from './types'

/**
 * How the Devices panel orders and folds its list.
 *
 * The server remembers a device's presence for 30 minutes after its last poll
 * (`PRESENCE_TTL_MS` in the backend's `groupsession.py`), and a device id lives
 * in localStorage — so every browser profile that ever opened the app is its own
 * device. A private window, a cleared site, a headless run: each leaves an entry
 * behind, and they all carry the same generated name. The panel showed eleven
 * rows reading "Chrome on Linux · Offline" and "Safari on iPhone · Offline"
 * above the one device you could actually invite.
 *
 * An offline device is not merely low-priority, it is INERT: the panel renders
 * no control for it at all (no Invite, no volume, nothing), because there is
 * nothing to send it. So it is folded away behind a count instead of taking a
 * row, and stays one tap from view.
 */
export interface PartitionedDevices {
    /** This device, group members and anything else online — in that order. */
    active: DeviceSummary[]
    /** Offline non-members, in the order the server sent them (oldest first). */
    offline: DeviceSummary[]
}

export function partitionDevices(devices: DeviceSummary[], selfId: string): PartitionedDevices {
    const isSelf = (device: DeviceSummary) => device.device_id === selfId

    // This device is never folded away, even if the server has not seen a poll
    // from it yet: the panel's own controls (Leave, fine-tune) live on that row.
    const active = devices.filter(device => isSelf(device) || device.joined || device.online)
    const offline = devices.filter(device => !isSelf(device) && !device.joined && !device.online)

    active.sort((a, b) => {
        if (isSelf(a)) return -1
        if (isSelf(b)) return 1
        return Number(b.joined) - Number(a.joined) || Number(b.online) - Number(a.online)
    })

    return { active, offline }
}
