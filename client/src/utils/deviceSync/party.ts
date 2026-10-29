import type { DeviceSummary } from './types'

/**
 * Joined devices from which a group session counts as a party (#548): the
 * PARTY sticker on the Devices button, and a faster Lauflicht.
 */
export const PARTY_MIN_DEVICES = 3

/** Devices the server lists as members of the group session (joined, online or not). */
export function groupSize(devices: DeviceSummary[]): number {
    return devices.filter(d => d.joined).length
}

export function isParty(devices: DeviceSummary[]): boolean {
    return groupSize(devices) >= PARTY_MIN_DEVICES
}
