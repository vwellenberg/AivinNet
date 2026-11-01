import { mount } from '@vue/test-utils'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import ChartsHeader from '@/components/Stats/ChartsHeader.vue'

// The header reveals the active tab with scrollIntoView, which jsdom lacks.
beforeAll(() => {
    if (!Element.prototype.scrollIntoView) {
        Element.prototype.scrollIntoView = vi.fn()
    }
})

function mountHeader(period: string) {
    return mount(ChartsHeader, { props: { name: 'artists', period } })
}

// The period tabs, in order, as the user reads them (the CSS uppercases them).
function periodTabs(w: ReturnType<typeof mountHeader>) {
    return w.findAll('[aria-label="Chart period"] button')
}

describe('ChartsHeader period tabs for the recap periods', () => {
    it('shows the five tabs for a period that is one of them', () => {
        const tabs = periodTabs(mountHeader('week'))

        expect(tabs.map(t => t.text())).toEqual(['day', 'week', 'month', 'year', 'alltime'])
        expect(tabs.filter(t => t.classes('active')).map(t => t.text())).toEqual(['week'])
    })

    it('adds last month as an extra active tab when the recap opened it', () => {
        const tabs = periodTabs(mountHeader('lastmonth'))

        expect(tabs.map(t => t.text())).toEqual(['day', 'week', 'month', 'year', 'alltime', 'Last month'])
        expect(tabs.filter(t => t.classes('active')).map(t => t.text())).toEqual(['Last month'])
        expect(tabs.at(-1)?.attributes('aria-pressed')).toBe('true')
    })

    it('adds last week as an extra active tab when the recap opened it', () => {
        const tabs = periodTabs(mountHeader('lastweek'))

        expect(tabs.at(-1)?.text()).toBe('Last week')
        expect(tabs.filter(t => t.classes('active')).map(t => t.text())).toEqual(['Last week'])
    })

    it('drops the extra tab once another tab is picked', async () => {
        const w = mountHeader('lastmonth')

        await periodTabs(w).find(t => t.text() === 'week')!.trigger('click')
        expect(w.emitted('changePeriod')?.[0]).toEqual(['week'])

        // The parent switches the period; the header follows it.
        await w.setProps({ period: 'week' })
        const tabs = periodTabs(w)
        expect(tabs.map(t => t.text())).toEqual(['day', 'week', 'month', 'year', 'alltime'])
        expect(tabs.filter(t => t.classes('active')).map(t => t.text())).toEqual(['week'])
    })

    it('shows no extra tab for a period it does not know', () => {
        // A value persisted by an older build: the tiles fall back to the week,
        // and so must the tab row, not grow a tab for the unknown word.
        const tabs = periodTabs(mountHeader('decade'))

        expect(tabs.map(t => t.text())).toEqual(['day', 'week', 'month', 'year', 'alltime'])
        expect(tabs.some(t => t.classes('active'))).toBe(false)
    })
})
