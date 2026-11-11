import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getSkipRate: vi.fn() }))

import SkipRate from '@/components/Stats/SkipRate.vue'
import { getSkipRate } from '@/requests/stats'

const track = (title: string) => ({ trackhash: title, title, artists: [{ name: 'The Artist' }] })

// As GET /logger/skips sends it (#537).
function payload(over: Partial<Record<string, unknown>> = {}) {
    return {
        plays: 20,
        skipped: 5,
        rate: 0.25,
        most_skipped: [{ trackhash: 'x', plays: 6, skipped: 6, share: 1, track: track('Blue') }],
        to_the_end: [{ trackhash: 'y', plays: 5, finished: 5, share: 1, track: track('Red') }],
        rules: { skip_below: 0.3, finished_from: 0.9, min_plays: 5, always: 0.9 },
        dates: 'Oct 20 - Oct 24',
        ...over,
    }
}

const answer = (data: unknown, status = 200) => ({ status, data }) as any

describe('SkipRate', () => {
    it('shows the overall rate, both rankings and the rules they were counted by', async () => {
        vi.mocked(getSkipRate).mockResolvedValue(answer(payload()))

        const w = mount(SkipRate, { props: { period: 'week' } })
        await flushPromises()

        expect(getSkipRate).toHaveBeenLastCalledWith('week')
        expect(w.find('.skip-value').text()).toBe('25 %')
        expect(w.find('.skip-caption').text()).toContain('for this week')
        expect(w.find('.skip-note').text()).toContain('under 30 %')
        expect(w.find('.skip-note').text()).toContain('90 % or more')
        expect(w.find('.skip-note').text()).toContain('at least 5 plays')
        expect(w.find('.skip-note').text()).toContain('lower bound')

        const headings = w.findAll('.skip-heading').map(h => h.text())
        expect(headings).toEqual(['Most skipped', 'Always to the end'])
        const rows = w.findAll('.skip-row')
        expect(rows[0].find('.skip-title').text()).toBe('Blue')
        expect(rows[0].find('.skip-percent').text()).toBe('100 %')
        expect(rows[0].find('.skip-count').text()).toBe('6 of 6 plays')
        expect(rows[1].find('.skip-title').text()).toBe('Red')
        expect(rows[1].find('.skip-count').text()).toBe('5 of 5 plays')
        expect(w.find('.skip-total').text()).toBe('5 of 20 plays')
    })

    it('ranks the rows, draws each share as a bar and shows the cover when there is one', async () => {
        const blue = { ...track('Blue'), image: 'abc.webp?pathhash=123' }
        vi.mocked(getSkipRate).mockResolvedValue(
            answer(
                payload({
                    most_skipped: [
                        { trackhash: 'x', plays: 6, skipped: 3, share: 0.5, track: blue },
                        { trackhash: 'z', plays: 5, skipped: 1, share: 0.2, track: track('Green') },
                    ],
                })
            )
        )

        const w = mount(SkipRate, { props: { period: 'week' } })
        await flushPromises()

        const rows = w.find('.skip-list.is-skipped').findAll('.skip-row')
        expect(rows.map(r => r.find('.skip-rank').text())).toEqual(['1', '2'])
        expect(rows[0].find('.skip-bar span').attributes('style')).toContain('width: 50%')
        expect(rows[0].find('img.skip-thumb').attributes('src')).toMatch(/abc\.webp\?pathhash=123$/)
        // Without an image a blank tile keeps the rows aligned.
        expect(rows[1].find('img').exists()).toBe(false)
        expect(rows[1].find('.skip-thumb').exists()).toBe(true)
        expect(w.find('.skip-meter span').attributes('style')).toContain('width: 25%')
    })

    it('draws nothing without a counted play', async () => {
        vi.mocked(getSkipRate).mockResolvedValue(
            answer(payload({ plays: 0, skipped: 0, rate: null, most_skipped: [], to_the_end: [] }))
        )

        const w = mount(SkipRate, { props: { period: 'week' } })
        await flushPromises()

        expect(w.find('.skip-rate').exists()).toBe(false)
    })

    it('leaves out a list with no track in it', async () => {
        vi.mocked(getSkipRate).mockResolvedValue(answer(payload({ to_the_end: [] })))

        const w = mount(SkipRate, { props: { period: 'week' } })
        await flushPromises()

        expect(w.findAll('.skip-heading').map(h => h.text())).toEqual(['Most skipped'])
    })

    it('draws nothing when the server does not answer 200', async () => {
        vi.mocked(getSkipRate).mockResolvedValue(answer({ msg: 'nope' }, 500))

        const w = mount(SkipRate, { props: { period: 'week' } })
        await flushPromises()

        expect(w.find('.skip-rate').exists()).toBe(false)
    })

    it('an answer to an earlier period does not paint over the later one', async () => {
        let late: (value: unknown) => void = () => {}
        vi.mocked(getSkipRate).mockReturnValueOnce(new Promise(resolve => (late = resolve)) as any)
        vi.mocked(getSkipRate).mockResolvedValueOnce(answer(payload({ rate: 0.5 })))

        const w = mount(SkipRate, { props: { period: 'week' } })
        await w.setProps({ period: 'month' })
        await flushPromises()
        expect(w.find('.skip-value').text()).toBe('50 %')

        // The week's answer arrives last: it must not repaint the month.
        late(answer(payload({ rate: 0.1 })))
        await flushPromises()
        expect(w.find('.skip-value').text()).toBe('50 %')
    })
})
