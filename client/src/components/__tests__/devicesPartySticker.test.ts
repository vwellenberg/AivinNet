import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import DevicesButton from '@/components/DeviceSync/DevicesButton.vue'
import useDeviceSync from '@/stores/devicesync'
import type { DeviceSummary } from '@/utils/deviceSync/types'

// PARTY sticker (#548): from three devices in the group it sticks to the Devices
// button; with two it is not there.
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

describe('PARTY sticker on the Devices button', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
    })

    it('is not there with two devices in the group', async () => {
        const ds = useDeviceSync()
        ds.devices = [device('pc', true), device('phone', true)]

        const wrapper = mount(DevicesButton)

        expect(wrapper.find('.devices-party-sticker').exists()).toBe(false)
    })

    it('appears with three devices in the group', async () => {
        const ds = useDeviceSync()
        ds.devices = [device('pc', true), device('phone', true), device('tablet', true)]

        const wrapper = mount(DevicesButton)

        const sticker = wrapper.find('.devices-party-sticker')
        expect(sticker.exists()).toBe(true)
        expect(sticker.text()).toBe('PARTY')
    })

    it('is not there for three devices on the network when only two have joined', async () => {
        const ds = useDeviceSync()
        ds.devices = [device('pc', true), device('phone', true), device('tablet', false)]

        const wrapper = mount(DevicesButton)

        expect(wrapper.find('.devices-party-sticker').exists()).toBe(false)
    })

    it('goes away again when a device leaves the group', async () => {
        const ds = useDeviceSync()
        ds.devices = [device('pc', true), device('phone', true), device('tablet', true)]

        const wrapper = mount(DevicesButton)
        expect(wrapper.find('.devices-party-sticker').exists()).toBe(true)

        ds.devices = [device('pc', true), device('phone', true), device('tablet', false)]
        await wrapper.vm.$nextTick()

        expect(wrapper.find('.devices-party-sticker').exists()).toBe(false)
    })
})
