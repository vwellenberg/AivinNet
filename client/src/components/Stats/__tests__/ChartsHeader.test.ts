import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

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

// On a phone the period plate is wider than the screen — always with a sixth
// recap tab — and its last tab was simply cut off: no fade, no arrow, while the
// stat tiles below said "swipe" with both (user, 2026-11-23).
describe('ChartsHeader on a narrow screen', () => {
    const stubbed: string[] = []
    const stub = (name: string, value: unknown) => {
        const descriptor = typeof value === 'function' ? { value } : { get: () => value }
        Object.defineProperty(Element.prototype, name, { configurable: true, ...descriptor })
        stubbed.push(name)
    }
    afterEach(() => {
        stubbed.splice(0).forEach(name => delete (Element.prototype as unknown as Record<string, unknown>)[name])
    })

    it('fades and arrows the edge that has tabs beyond it', async () => {
        stub('scrollWidth', 400)
        stub('clientWidth', 300)
        const w = mountHeader('lastmonth')
        await flushPromises()

        const scrollers = w.findAll('.seg-scroll')
        expect(scrollers).toHaveLength(2)
        for (const box of scrollers) {
            expect(box.classes()).toContain('has-next')
            expect(box.classes()).not.toContain('has-prev')
        }
        expect(w.findAll('.segnav.next')).toHaveLength(2)
        expect(w.find('.segnav.prev').exists()).toBe(false)
        w.unmount()
    })

    it('moves the plate by a page when its arrow is pressed', async () => {
        stub('scrollWidth', 400)
        stub('clientWidth', 300)
        const scrollBy = vi.fn()
        stub('scrollBy', scrollBy)
        const w = mountHeader('week')
        await flushPromises()

        await w.find('[aria-label="Scroll periods right"]').trigger('click')
        expect(scrollBy).toHaveBeenCalledWith({ left: 240, behavior: 'smooth' })
        w.unmount()
    })

    it('shows neither when the tabs fit', async () => {
        stub('scrollWidth', 300)
        stub('clientWidth', 300)
        const w = mountHeader('week')
        await flushPromises()

        expect(w.find('.segnav').exists()).toBe(false)
        expect(w.find('.has-next').exists()).toBe(false)
        w.unmount()
    })
})
