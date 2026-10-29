import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getListeningDevices: vi.fn() }))

import ListeningDevices from '@/components/Stats/ListeningDevices.vue'
import { getListeningDevices } from '@/requests/stats'

// As GET /logger/devices sends it (#541): the largest share first.
function payload(over: Partial<Record<string, unknown>> = {}) {
    return {
        total: 1000,
        devices: [
            { device_id: 'phone', name: 'Chrome on Android', kind: 'device', seconds: 600, share: 0.6 },
            { device_id: 'desk', name: 'Firefox on Linux', kind: 'device', seconds: 300, share: 0.3 },
            { device_id: null, name: '', kind: 'other', seconds: 70, share: 0.07 },
            { device_id: null, name: '', kind: 'none', seconds: 30, share: 0.03 },
        ],
        dates: 'Oct 20 - Oct 24',
        ...over,
    }
}

const answer = (data: unknown, status = 200) => ({ status, data }) as any

describe('ListeningDevices (#541)', () => {
    it('shares the time listened out by device, with the names from the registry', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer(payload()))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        expect(getListeningDevices).toHaveBeenLastCalledWith('week')
        const rows = w.findAll('.devices-row').map(r => r.text())
        expect(rows[0]).toContain('Chrome on Android')
        expect(rows[0]).toContain('60 %')
        expect(rows[0]).toContain('10 minutes')
        expect(rows[1]).toContain('Firefox on Linux')
        expect(rows[1]).toContain('30 %')
    })

    it('says what the rows that are not a device are', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer(payload()))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        const rows = w.findAll('.devices-row').map(r => r.text())
        expect(rows[2]).toContain('Other device')
        expect(rows[3]).toContain('No device recorded')
    })

    it('fills each bar to its share', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer(payload()))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        const fills = w.findAll('.devices-bar span').map(s => (s.element as HTMLElement).style.width)
        expect(fills).toEqual(['60%', '30%', '7%', '3%'])
    })

    it('explains that devices are recorded from this version on', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer(payload()))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        expect(w.find('.devices-note').text()).toContain('from this version on')
    })

    it('draws nothing without any listening in the period', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer(payload({ total: 0, devices: [] })))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        expect(w.find('.listening-devices').exists()).toBe(false)
    })

    it('draws nothing when the server does not answer 200', async () => {
        vi.mocked(getListeningDevices).mockResolvedValue(answer({ msg: 'nope' }, 500))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await flushPromises()

        expect(w.find('.listening-devices').exists()).toBe(false)
    })

    it('an answer to an earlier period does not paint over the later one', async () => {
        let late: (value: unknown) => void = () => {}
        vi.mocked(getListeningDevices).mockReturnValueOnce(new Promise(resolve => (late = resolve)) as any)
        vi.mocked(getListeningDevices).mockResolvedValueOnce(answer(payload({ total: 100, devices: [
            { device_id: 'phone', name: 'Chrome on Android', kind: 'device', seconds: 100, share: 1 },
        ] })))

        const w = mount(ListeningDevices, { props: { period: 'week' } })
        await w.setProps({ period: 'month' })
        await flushPromises()
        expect(w.find('.devices-share').text()).toBe('100 %')

        // The week's answer arrives last: it must not repaint the month.
        late(answer(payload({ devices: [
            { device_id: 'desk', name: 'Firefox on Linux', kind: 'device', seconds: 10, share: 0.1 },
        ] })))
        await flushPromises()
        expect(w.find('.devices-share').text()).toBe('100 %')
    })
})
