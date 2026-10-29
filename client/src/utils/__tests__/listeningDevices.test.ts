import { describe, expect, it } from 'vitest'

import { barWidth, deviceLabel, devicePercent } from '@/utils/listeningDevices'

describe('deviceLabel (#541)', () => {
    it('names a registered device as the registry does', () => {
        expect(deviceLabel({ kind: 'device', name: 'Chrome on Android' })).toBe('Chrome on Android')
    })

    it('says what the two rows that are not a device are', () => {
        expect(deviceLabel({ kind: 'other', name: '' })).toBe('Other device')
        expect(deviceLabel({ kind: 'none', name: '' })).toBe('No device recorded')
    })

    it('does not leave a registered device nameless', () => {
        expect(deviceLabel({ kind: 'device', name: '' })).toBe('Unnamed device')
    })
})

describe('devicePercent and barWidth (#541)', () => {
    it('rounds a share to whole percent, as the skip quote does', () => {
        expect(devicePercent(0.6)).toBe('60 %')
        expect(devicePercent(0.8333)).toBe('83 %')
        expect(devicePercent(0)).toBe('0 %')
    })

    it('reads a share that is not a number as a dash', () => {
        expect(devicePercent(Number.NaN)).toBe('—')
    })

    it('fills the bar to the share and never past the track', () => {
        expect(barWidth(0.4)).toBe('40%')
        expect(barWidth(1.2)).toBe('100%')
        expect(barWidth(-0.1)).toBe('0%')
        expect(barWidth(Number.NaN)).toBe('0%')
    })
})
