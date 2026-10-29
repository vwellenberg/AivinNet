import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/searchMusic', () => ({ getServerCard: vi.fn() }))

import ServerCard from '@/components/SearchView/ServerCard.vue'
import { getServerCard } from '@/requests/searchMusic'

// As GET /search/server-card answers it (#547): numbers only, plays and the
// oldest play null until the server has counted them.
const card = {
    version: '2026.10.1',
    uptime: 3 * 86400 + 5 * 3600 + 59,
    tracks: 12671,
    albums: 1034,
    artists: 412,
    plays: 98765,
    since: Date.UTC(2025, 2, 3, 12) / 1000,
}

beforeEach(() => {
    vi.mocked(getServerCard).mockReset()
})

describe('ServerCard on the search "aivin" (#547)', () => {
    it('shows for "aivin", whatever the case, with the server\'s numbers', async () => {
        vi.mocked(getServerCard).mockResolvedValue(card as any)
        const w = mount(ServerCard, { props: { query: ' AIVIN ' } })
        await flushPromises()

        expect(getServerCard).toHaveBeenCalledTimes(1)
        expect(w.find('.server-card').exists()).toBe(true)
        expect(w.text()).toContain('AivinNet v2026.10.1')
        expect(w.text()).toContain('Up for 3 d 5 h')
        expect(w.text()).toContain('since March 3, 2025')
        expect(w.text()).toContain('12,671')
        expect(w.text()).toContain('1,034')
        expect(w.text()).toContain('412')
        expect(w.text()).toContain('98,765')
    })

    it('is hidden for every other query, and asks the server for nothing', async () => {
        for (const query of ['', 'aivin music', 'aiv', 'vin']) {
            const w = mount(ServerCard, { props: { query } })
            await flushPromises()

            expect(w.find('.server-card').exists(), query).toBe(false)
        }
        expect(getServerCard).not.toHaveBeenCalled()
    })

    it('shows a dash instead of zero for plays the server has not counted', async () => {
        vi.mocked(getServerCard).mockResolvedValue({ ...card, plays: null, since: null } as any)
        const w = mount(ServerCard, { props: { query: 'aivin' } })
        await flushPromises()

        expect(w.text()).toContain('—')
        expect(w.text()).not.toContain('since')
    })

    it('draws nothing when the answer fails', async () => {
        vi.mocked(getServerCard).mockResolvedValue({ error: new Error('500'), data: undefined } as any)
        const w = mount(ServerCard, { props: { query: 'aivin' } })
        await flushPromises()

        expect(w.find('.server-card').exists()).toBe(false)
    })
})
