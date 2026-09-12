import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// Same seams as the store suite: player.ts builds real <audio> elements at
// import, and every membership button is an HTTP call.
const { requestsMock } = vi.hoisted(() => ({
    requestsMock: {
        registerDevice: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        pollSession: vi.fn(() => Promise.resolve(null)),
        joinGroup: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        leaveGroup: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        setQueue: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        sendCommand: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
        resolveTracks: vi.fn(() => Promise.resolve([] as any[])),
    },
}))

vi.mock('@/stores/player', () => ({
    usePlayer: () => ({
        clearNextAudio: vi.fn(),
        clearMovingNextTimeout: vi.fn(),
        setVolume: vi.fn(),
        setMute: vi.fn(),
    }),
    audioSource: { pausePlayingSource: vi.fn(), playPlayingSource: vi.fn(() => Promise.resolve()) },
    getUrl: () => '',
}))
vi.mock('@/requests/devicesync', () => requestsMock)

import Devices from '@/components/modals/Devices.vue'
import useDeviceSync, { __resetDeviceSyncTestState } from '@/stores/devicesync'

const device = (over: Partial<any> = {}): any => ({
    device_id: 'devB',
    name: 'Chrome on Android',
    type: 'mobile',
    online: true,
    joined: true,
    volume: 1,
    mute: false,
    is_leader: false,
    ...over,
})

const self = (over: Partial<any> = {}) => device({ device_id: 'devA', name: 'This one', ...over })

/** The button carrying `label`, whatever row it sits in. */
const button = (w: any, label: string) => {
    const all = w.findAll('button')
    const found = all.filter((b: any) => b.text() === label)
    // The label IS the assertion in these tests, so a miss must say what the
    // panel actually rendered instead.
    expect(found.length, `button "${label}" among [${all.map((b: any) => b.text()).join(' | ')}]`).toBe(1)
    return found[0]
}

/**
 * A deferred request: the point of these tests is the window BETWEEN the tap
 * and the server's answer, which a resolved mock skips over entirely.
 */
function deferred() {
    let release: (value: any) => void = () => {}
    const promise = new Promise(r => (release = r))
    return { promise, release: (value: any = { status: 200, data: {} }) => release(value) }
}

// ---------------------------------------------------------------------------
// Leaving and joining are round trips, and this panel renders the SERVER's
// device list — which only the next poll refreshes (5 s away once solo). So
// both buttons used to sit there unchanged after the tap: no feedback at all,
// while the request was very much on its way. A second tap then fired a second
// join/leave. The buttons now name what they are doing and stop taking taps.
// ---------------------------------------------------------------------------
describe('Devices panel — membership buttons', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        __resetDeviceSyncTestState()
        setActivePinia(createPinia())
        localStorage.clear()
    })

    it('the Leave button reports the pending leave and refuses a second tap', async () => {
        const ds = useDeviceSync()
        ds.deviceId = 'devA'
        ds.joined = true
        ds.devices = [self(), device()]

        const w = mount(Devices)
        const leave = button(w, 'Leave')

        const { promise, release } = deferred()
        requestsMock.leaveGroup.mockReturnValueOnce(promise as any)

        await leave.trigger('click')
        await nextTick()

        expect(leave.text()).toBe('Leaving…')
        expect(leave.attributes('disabled')).toBeDefined()

        await leave.trigger('click')
        expect(requestsMock.leaveGroup).toHaveBeenCalledTimes(1)

        release()
        await flushPromises()

        // Answer in: the row stops claiming membership right away instead of
        // waiting for the next poll.
        expect(button(w, 'Join group').attributes('disabled')).toBeUndefined()
    })

    it('the Join button reports the pending join and refuses a second tap', async () => {
        const ds = useDeviceSync()
        ds.deviceId = 'devA'
        ds.joined = false
        ds.devices = [self({ joined: false }), device()]

        const w = mount(Devices)
        const join = button(w, 'Join group')

        const { promise, release } = deferred()
        requestsMock.joinGroup.mockReturnValueOnce(promise as any)

        await join.trigger('click')
        await nextTick()

        expect(join.text()).toBe('Joining…')
        expect(join.attributes('disabled')).toBeDefined()

        await join.trigger('click')
        expect(requestsMock.joinGroup).toHaveBeenCalledTimes(1)

        release({ status: 200, data: {} })
    })

    it('the Invite button reports the pending invite and refuses a second tap', async () => {
        const ds = useDeviceSync()
        ds.deviceId = 'devA'
        ds.joined = true
        ds.devices = [self(), device({ joined: false })]

        const w = mount(Devices)
        const invite = button(w, 'Invite')

        const { promise, release } = deferred()
        requestsMock.sendCommand.mockReturnValueOnce(promise as any)

        await invite.trigger('click')
        await nextTick()

        expect(invite.text()).toBe('Inviting…')
        expect(invite.attributes('disabled')).toBeDefined()

        await invite.trigger('click')
        expect(requestsMock.sendCommand).toHaveBeenCalledTimes(1)

        release()
        await flushPromises()
        expect(button(w, 'Invite').attributes('disabled')).toBeUndefined()
    })
})
