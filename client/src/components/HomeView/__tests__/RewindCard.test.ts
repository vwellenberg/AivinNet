import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getRewindYears: vi.fn() }))
vi.mock('@/router', () => ({ Routes: { Rewind: 'RewindView' } }))
const { celebrate } = vi.hoisted(() => ({ celebrate: vi.fn() }))
vi.mock('@/utils/confetti', () => ({ celebrate }))

import RewindCard from '@/components/HomeView/RewindCard.vue'
import { getRewindYears } from '@/requests/stats'

const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

// As GET /logger/rewind/years sends it (#572).
async function card(fresh: number | null, on: Date, status = 200) {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(on)
    vi.mocked(getRewindYears).mockResolvedValue({ status, data: { years: [2024, 2025], seen: [], fresh } } as any)
    const w = mount(RewindCard, { global: { stubs } })
    await flushPromises()
    return w
}

afterEach(() => {
    vi.useRealTimers()
    celebrate.mockReset()
    localStorage.clear()
})

describe('RewindCard on Home (#572)', () => {
    it('announces the fresh Rewind in January, with a way there', async () => {
        const w = await card(2025, new Date(2026, 0, 12))

        expect(w.find('.rewind-card-title').text()).toBe('Your 2025 Rewind')
        expect(JSON.parse(w.find('a').attributes('data-to')!)).toEqual({ name: 'RewindView', params: { year: 2025 } })
    })

    it('stays away after January, once seen, and without an answer', async () => {
        expect((await card(2025, new Date(2026, 1, 1))).find('.rewind-card').exists()).toBe(false)
        expect((await card(null, new Date(2026, 0, 12))).find('.rewind-card').exists()).toBe(false)
        expect((await card(2025, new Date(2026, 0, 12), 500)).find('.rewind-card').exists()).toBe(false)
    })

    it('greets the new year with one burst of confetti out of the card, once per year', async () => {
        await card(2025, new Date(2026, 0, 1))
        expect(celebrate).toHaveBeenCalledTimes(1)
        const [pieces, from] = celebrate.mock.calls[0]
        expect(pieces).toBeGreaterThan(0)
        expect(from).toEqual({ x: expect.any(Number), y: expect.any(Number) })

        // The next visit to Home: the card is still there, the burst is not.
        await card(2025, new Date(2026, 0, 2))
        expect(celebrate).toHaveBeenCalledTimes(1)
    })

    it('makes no burst where there is no card', async () => {
        await card(null, new Date(2026, 0, 1))
        await card(2025, new Date(2026, 5, 1))
        expect(celebrate).not.toHaveBeenCalled()
    })
})
