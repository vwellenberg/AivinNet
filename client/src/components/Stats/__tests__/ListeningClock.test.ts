import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/stats', () => ({ getListeningClock: vi.fn() }))
const { isSmall } = vi.hoisted(() => ({ isSmall: { value: false } }))
vi.mock('@/stores/content-width', () => ({ isSmall }))

import ListeningClock from '@/components/Stats/ListeningClock.vue'
import { getListeningClock } from '@/requests/stats'

// As GET /logger/clock sends it (#535): Monday first, 24 hours a row.
function payload(cells: [number, number, number][]) {
    const days = Array.from({ length: 7 }, () => Array(24).fill(0))
    for (const [day, hour, seconds] of cells) days[day][hour] = seconds
    const [day, hour, seconds] = cells[0] ?? [0, 0, 0]
    return {
        days,
        total: cells.reduce((sum, [, , s]) => sum + s, 0),
        peak_hour: cells.length ? { day, hour, seconds } : null,
        peak_day: cells.length ? { day, seconds } : null,
        dates: 'Oct 20 - Oct 24',
    }
}

const answer = (data: unknown, status = 200) => ({ status, data }) as any

describe('ListeningClock', () => {
    it('draws seven rows of 24 hours, shaded against the busiest hour', async () => {
        vi.mocked(getListeningClock).mockResolvedValue(
            answer(
                payload([
                    [4, 20, 3600],
                    [0, 8, 900],
                ])
            )
        )

        const w = mount(ListeningClock, { props: { period: 'week' } })
        await flushPromises()

        expect(getListeningClock).toHaveBeenLastCalledWith('week')
        expect(w.find('.clock-grid').attributes('style')).toContain('--columns: 24')
        const cells = w.findAll('.clock-grid .clock-cell')
        expect(cells).toHaveLength(7 * 24)
        expect(cells[4 * 24 + 20].classes()).toContain('level-4')
        expect(cells[4 * 24 + 20].attributes('title')).toBe('Friday 20:00–21:00 · 1 h')
        expect(cells[8].classes()).toContain('level-1')
        expect(w.findAll('.clock-label.is-row').map(d => d.text())).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])

        expect(w.findAll('.clock-peak').map(p => p.text())).toEqual(['Fri 20:00busiest hour', 'Fridaybusiest day'])
        expect(w.find('.clock-note').text()).toContain('for this week')
        expect(w.find('.clock-note').text()).toContain('after midnight counts as the new day')
        expect(w.find('.clock-grid').attributes('aria-label')).toBe(
            'Listening clock for this week: most music on Fridays, the busiest hour Friday from 20:00.'
        )
    })

    it('follows the period, and an answer to an earlier one does not paint', async () => {
        let late: (value: unknown) => void = () => {}
        vi.mocked(getListeningClock)
            .mockReturnValueOnce(new Promise(resolve => (late = resolve)) as any)
            .mockResolvedValueOnce(answer(payload([[2, 9, 600]])))

        const w = mount(ListeningClock, { props: { period: 'week' } })
        await w.setProps({ period: 'year' })
        await flushPromises()
        late(answer(payload([[4, 20, 3600]])))
        await flushPromises()

        expect(getListeningClock).toHaveBeenLastCalledWith('year')
        expect(w.find('.clock-peak').text()).toContain('Wed 09:00')
    })

    it('is not there without music in the period, or without an answer', async () => {
        vi.mocked(getListeningClock).mockResolvedValue(answer(payload([])))
        const empty = mount(ListeningClock, { props: { period: 'day' } })
        await flushPromises()
        expect(empty.find('.listening-clock').exists()).toBe(false)

        vi.mocked(getListeningClock).mockResolvedValue(answer({ msg: 'no' }, 500))
        const failed = mount(ListeningClock, { props: { period: 'week' } })
        await flushPromises()
        expect(failed.find('.listening-clock').exists()).toBe(false)
    })

    it('stands upright on a phone: the days across, the hours down', async () => {
        isSmall.value = true
        vi.mocked(getListeningClock).mockResolvedValue(answer(payload([[4, 20, 3600]])))

        const w = mount(ListeningClock, { props: { period: 'week' } })
        await flushPromises()
        isSmall.value = false

        const grid = w.find('.clock-grid')
        expect(grid.classes()).toContain('upright')
        expect(grid.attributes('style')).toContain('--columns: 7')
        // Row by row: hour 20 is the 21st row, Friday its fifth square.
        const cells = grid.findAll('.clock-cell')
        expect(cells[20 * 7 + 4].attributes('title')).toBe('Friday 20:00–21:00 · 1 h')
        expect(cells[20 * 7 + 4].classes()).toContain('level-4')
    })
})
