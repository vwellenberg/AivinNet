import { describe, expect, it } from 'vitest'

import { partitionDevices } from '../deviceList'
import type { DeviceSummary } from '../types'

function device(overrides: Partial<DeviceSummary> & { device_id: string }): DeviceSummary {
    return {
        name: 'Chrome on Linux',
        type: 'desktop',
        online: false,
        joined: false,
        volume: 1,
        mute: false,
        is_leader: false,
        ...overrides,
    }
}

// The list the panel actually received on 2026-07-31: one usable device and
// eleven stale ones, all auto-named, left behind by browser profiles that came
// and went inside the server's 30-minute presence window.
const FIELD_LIST: DeviceSummary[] = [
    device({ device_id: 'linux-1' }),
    device({ device_id: 'linux-2' }),
    device({ device_id: 'iphone-1', name: 'Safari on iPhone', type: 'mobile' }),
    device({ device_id: 'linux-3' }),
    device({ device_id: 'iphone-2', name: 'Safari on iPhone', type: 'mobile' }),
    device({ device_id: 'iphone-3', name: 'Safari on iPhone', type: 'mobile' }),
    device({ device_id: 'iphone-4', name: 'Safari on iPhone', type: 'mobile' }),
    device({ device_id: 'linux-4' }),
    device({ device_id: 'linux-5' }),
    device({ device_id: 'iphone-5', name: 'Safari on iPhone', type: 'mobile' }),
    device({ device_id: 'linux-6' }),
    device({ device_id: 'self', name: 'Chrome on Windows', online: true }),
]

describe('partitionDevices', () => {
    it('folds away the stale entries a browser profile leaves behind', () => {
        const { active, offline } = partitionDevices(FIELD_LIST, 'self')

        expect(active.map(d => d.device_id)).toEqual(['self'])
        expect(offline).toHaveLength(11)
    })

    it('keeps this device even when the server has not seen it poll yet', () => {
        const devices = [device({ device_id: 'self' }), device({ device_id: 'other' })]
        const { active, offline } = partitionDevices(devices, 'self')

        expect(active.map(d => d.device_id)).toEqual(['self'])
        expect(offline.map(d => d.device_id)).toEqual(['other'])
    })

    // A member that dropped off the network is still a member until the server
    // reaps it, and its row carries the Remove button — folding it away would
    // hide the only way out of the group for it.
    it('keeps an offline group member visible', () => {
        const devices = [
            device({ device_id: 'self', online: true }),
            device({ device_id: 'ghost', joined: true, online: false }),
        ]
        const { active, offline } = partitionDevices(devices, 'self')

        expect(active.map(d => d.device_id)).toEqual(['self', 'ghost'])
        expect(offline).toHaveLength(0)
    })

    it('orders active devices: this one, then members, then the rest online', () => {
        const devices = [
            device({ device_id: 'online-other', online: true }),
            device({ device_id: 'member', online: true, joined: true }),
            device({ device_id: 'self', online: true }),
        ]

        expect(partitionDevices(devices, 'self').active.map(d => d.device_id)).toEqual([
            'self',
            'member',
            'online-other',
        ])
    })

    it('leaves the input array alone', () => {
        const devices = [
            device({ device_id: 'online-other', online: true }),
            device({ device_id: 'self', online: true }),
        ]
        partitionDevices(devices, 'self')

        expect(devices.map(d => d.device_id)).toEqual(['online-other', 'self'])
    })
})
