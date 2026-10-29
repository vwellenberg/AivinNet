import { describe, expect, it } from 'vitest'

import { groupSize, isParty, PARTY_MIN_DEVICES } from '../deviceSync/party'
import type { DeviceSummary } from '../deviceSync/types'

function device(id: string, joined: boolean): DeviceSummary {
    return {
        device_id: id,
        name: id,
        type: 'desktop',
        online: true,
        joined,
        volume: 50,
        mute: false,
        is_leader: false,
        trim_ms: null,
    }
}

describe('party (#548)', () => {
    it('starts at three devices', () => {
        expect(PARTY_MIN_DEVICES).toBe(3)
    })

    it('counts only the devices that have joined the group', () => {
        const devices = [device('pc', true), device('phone', true), device('tablet', false), device('tv', false)]

        expect(groupSize(devices)).toBe(2)
    })

    it('is no party with two devices in the group', () => {
        expect(isParty([device('pc', true), device('phone', true)])).toBe(false)
    })

    it('is a party from three devices in the group', () => {
        expect(isParty([device('pc', true), device('phone', true), device('tablet', true)])).toBe(true)
    })

    it('three devices on the network but only two in the group is no party', () => {
        const devices = [device('pc', true), device('phone', true), device('tablet', false)]

        expect(isParty(devices)).toBe(false)
    })

    it('no devices, no party', () => {
        expect(isParty([])).toBe(false)
    })
})
