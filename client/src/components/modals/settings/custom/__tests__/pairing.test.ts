import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The pairing panel used to write its error into the QR container — which only
// exists once the code has loaded (`v-if`). A failed request therefore threw a
// TypeError inside onMounted, and the panel sat on its spinner forever with no
// message. These tests pin every way out of "loading".
const { sendPairRequest, getRawData } = vi.hoisted(() => ({
    sendPairRequest: vi.fn(),
    getRawData: vi.fn(),
}))

vi.mock('@/requests/auth', () => ({ sendPairRequest }))
vi.mock('qr-code-styling', () => ({
    default: class {
        getRawData = getRawData
    },
}))

import Pairing from '@/components/modals/settings/custom/Pairing.vue'

const createObjectURL = vi.fn(() => 'blob:qr')
const revokeObjectURL = vi.fn()

beforeEach(() => {
    sendPairRequest.mockReset()
    getRawData.mockReset()
    createObjectURL.mockClear()
    revokeObjectURL.mockClear()
    // jsdom has no object URLs
    URL.createObjectURL = createObjectURL as any
    URL.revokeObjectURL = revokeObjectURL
})

afterEach(() => {
    vi.restoreAllMocks()
})

const settle = async () => {
    const w = mount(Pairing)
    await flushPromises()
    return w
}

describe('Pairing panel', () => {
    it('shows the QR code once the pair code arrives', async () => {
        sendPairRequest.mockResolvedValue({ status: 200, data: { code: 'AbC123' } })
        getRawData.mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }))

        const w = await settle()

        expect(w.find('.spinner').exists()).toBe(false)
        expect(w.find('.qrcode img').attributes('src')).toBe('blob:qr')
        expect(w.find('.error').exists()).toBe(false)
    })

    it('replaces the spinner with an error when the server refuses', async () => {
        sendPairRequest.mockResolvedValue({ status: 500, data: {} })

        const w = await settle()

        expect(w.find('.spinner').exists()).toBe(false)
        expect(w.find('.error').text()).toContain('500')
        expect(getRawData).not.toHaveBeenCalled()
    })

    it('names a dead connection instead of printing "undefined"', async () => {
        // useAxios answers a network failure with `status: undefined`
        sendPairRequest.mockResolvedValue({ error: 'Network Error', status: undefined })

        const w = await settle()

        expect(w.find('.spinner').exists()).toBe(false)
        const text = w.find('.error').text()
        expect(text).not.toContain('undefined')
        expect(text).toContain('Network Error')
    })

    it('shows an error when the QR code itself cannot be drawn', async () => {
        sendPairRequest.mockResolvedValue({ status: 200, data: { code: 'AbC123' } })
        getRawData.mockRejectedValue(new Error('canvas exploded'))

        const w = await settle()

        expect(w.find('.spinner').exists()).toBe(false)
        expect(w.find('.qrcode').exists()).toBe(false)
        expect(w.find('.error').exists()).toBe(true)
    })

    it('releases the object URL when the panel closes', async () => {
        sendPairRequest.mockResolvedValue({ status: 200, data: { code: 'AbC123' } })
        getRawData.mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }))

        const w = await settle()
        w.unmount()

        expect(revokeObjectURL).toHaveBeenCalledWith('blob:qr')
    })
})
