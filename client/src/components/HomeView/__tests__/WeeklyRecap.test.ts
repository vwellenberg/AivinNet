import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { WeeklyRecap as RecapCard } from '@/requests/home'
import useHome from '@/stores/home'

const { dismissWeeklyRecap, push, setStatsPeriod } = vi.hoisted(() => ({
    dismissWeeklyRecap: vi.fn(),
    push: vi.fn(),
    setStatsPeriod: vi.fn(),
}))

// The recap comes with Home's answer (#776): the store holds it, the card reads it.
vi.mock('@/requests/home', () => ({ dismissWeeklyRecap }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/router', () => ({ Routes: { Stats: 'StatsView' } }))
vi.mock('@/stores/settings', () => ({ default: () => ({ setStatsPeriod }) }))

import WeeklyRecap from '@/components/HomeView/WeeklyRecap.vue'

// As GET /nothome/recap sends it (#530).
const week = {
    key: 'week:2026-10-19',
    kind: 'week',
    plays: 6,
    listened: '24 mins',
    top_artist: { artisthash: 'a1', name: 'Dream.Corp' },
    new_albums: 3,
    top_track: { trackhash: 't1', title: 'Stoned', artist: 'Dream.Corp', image: null },
}

async function card(recap: unknown, status = 200) {
    // A failed answer carries no recap, as Home's answer does not then either.
    useHome().recap = status === 200 ? ((recap ?? null) as RecapCard | null) : null
    const w = mount(WeeklyRecap)
    await flushPromises()
    return w
}

beforeEach(() => {
    setActivePinia(createPinia())
    dismissWeeklyRecap.mockReset().mockResolvedValue({ status: 200, data: { msg: 'Dismissed' } })
    push.mockReset()
    setStatsPeriod.mockReset()
})

describe('WeeklyRecap on Home (#530)', () => {
    it('renders the period in the Continue card’s words', async () => {
        const w = await card(week)

        expect(w.find('.recap-card').exists()).toBe(true)
        expect(w.find('.kicker').text()).toBe('Last week')
        expect(w.find('.headline').text()).toBe('24 mins')
        expect(w.find('.detail').text()).toBe('mostly Dream.Corp · 3 new albums · top track Stoned')
    })

    it('shows no card when the server has none', async () => {
        expect((await card(null)).find('.recap-card').exists()).toBe(false)
        expect((await card(week, 500)).find('.recap-card').exists()).toBe(false)
    })

    it('opens Stats on the period the card tells about', async () => {
        const w = await card({ ...week, kind: 'month', key: 'month:2026-10' })

        await w.find('.recap-open').trigger('click')

        // Last month, not this month: the 1st has no days of this month yet.
        expect(setStatsPeriod).toHaveBeenCalledWith('lastmonth')
        expect(push).toHaveBeenCalledWith({ name: 'StatsView' })
    })

    it('opens Stats on last week’s tab for a weekly card', async () => {
        const w = await card(week)

        await w.find('.recap-open').trigger('click')

        // Last week, not this week: on a Monday this week has no plays yet.
        expect(setStatsPeriod).toHaveBeenCalledWith('lastweek')
    })

    it('is dismissed at once and tells the server which period it closed', async () => {
        const w = await card(week)

        await w.find('.recap-close').trigger('click')

        expect(w.find('.recap-card').exists()).toBe(false)
        expect(dismissWeeklyRecap).toHaveBeenCalledWith('week:2026-10-19')
        expect(setStatsPeriod).not.toHaveBeenCalled()
        expect(push).not.toHaveBeenCalled()
    })

    it('marks the dismiss glyph with the quiet button role', async () => {
        const w = await card(week)

        expect(w.find('.recap-close').classes()).toContain('btn-quiet')
        expect(w.find('.recap-close').attributes('aria-label')).toBe('Dismiss recap')
    })
})

// The text veil (`mem-dots-veil`) reaches 10–14 px past its host with a blur. On
// `.recap-open`, which fills the whole card, it lay over the card's frame and
// shadow and turned them whitish (user, 2026-11-02). It belongs on the lines.
describe('WeeklyRecap: the text veil stays inside the card', () => {
    const source = Object.values(
        import.meta.glob('/src/components/HomeView/WeeklyRecap.vue', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
    )[0]
    const style = source.slice(source.indexOf('<style')).replace(/\/\/[^\n]*/g, '')

    function block(selector: string): string {
        const at = style.indexOf(selector + ' {')
        if (at < 0) return ''
        return style.slice(at, style.indexOf('\n    }', at))
    }

    it('reads the stylesheet (parser guard)', () => {
        expect(block('.recap-open')).toContain('flex: 1')
    })

    it('puts the veil on the lines, never on the full-card button', () => {
        expect(block('.recap-open')).not.toContain('mem-dots-veil')
        expect(block('.recap-lines')).toContain('@include mem-dots-veil')
        expect(source).toMatch(/<button class="recap-open"[^>]*>\s*<span class="recap-lines">/)
    })
})
