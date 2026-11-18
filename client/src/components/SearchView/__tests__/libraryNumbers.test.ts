import { flushPromises, mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// The library numbers on the idle search page are the charts screen's row.
//
// On a phone the row ended in a hard-cut tile: no fade at the edge and no
// arrow, while the same tiles on the charts screen had both (user,
// 2026-11-18). The block laid the tiles out itself; it now hands them to
// `Stats.vue`, which carries the fade and the arrows. And the arrows show on
// touch too — they were hidden behind `(pointer: coarse)`, i.e. on exactly the
// device that reported the cut.
// ---------------------------------------------------------------------------

vi.mock('@/requests/stats', () => ({
    getStats: vi.fn(async () => ({
        status: 200,
        // The order /logger/stats really sends, plus the top track this block drops.
        data: {
            stats: [
                { cssclass: 'toptrack', text: 'Top track this week', value: 'Tommy the Cat - Primus', image: 'abc.webp' },
                { cssclass: 'streams', text: 'this week', value: '139 track plays' },
                { cssclass: 'playtime', text: 'listened this week', value: '5 hrs, 54 mins' },
                { cssclass: 'favorites', text: 'this week', value: '7 new favorites' },
                { cssclass: 'trackcount', text: 'in your library', value: '12,560 tracks' },
            ],
            dates: 'Nov 11 - Nov 18',
        },
    })),
    getDiscoveries: vi.fn(),
}))

import LibraryNumbers from '@/components/SearchView/LibraryNumbers.vue'
import Stats from '@/components/Stats/Stats.vue'

// jsdom lays nothing out: 300 px visible, 900 px of tiles.
const stubbed: string[] = []
function geometry(scrollWidth: number, clientWidth: number) {
    for (const [name, value] of [['scrollWidth', scrollWidth], ['clientWidth', clientWidth]] as const) {
        Object.defineProperty(Element.prototype, name, { configurable: true, get: () => value })
        stubbed.push(name)
    }
}
afterEach(() => {
    stubbed.splice(0).forEach(name => delete (Element.prototype as unknown as Record<string, unknown>)[name])
})

describe('LibraryNumbers', () => {
    it('renders the four numbers through the shared Stats row', async () => {
        const w = mount(LibraryNumbers, { global: { stubs: { StatItem: true } } })
        await flushPromises()

        const row = w.findComponent(Stats)
        expect(row.exists()).toBe(true)
        expect((row.props('items') ?? []).map(i => i.cssclass)).toEqual([
            'trackcount',
            'streams',
            'playtime',
            'favorites',
        ])
        // No date range here: that belongs to the charts screen.
        expect(w.find('.statsdates').exists()).toBe(false)
    })

    it('shows the arrow when tiles run past the edge', async () => {
        geometry(900, 300)
        const w = mount(LibraryNumbers, { attachTo: document.body, global: { stubs: { StatItem: true } } })
        await flushPromises()

        expect(w.find('.statsnav.next').exists()).toBe(true)
        expect(w.find('.statshead').classes()).toContain('has-next')
        w.unmount()
    })
})

describe('Stats arrows on touch', () => {
    it('are not hidden on a coarse pointer', () => {
        const source = readFileSync('src/components/Stats/Stats.vue', 'utf8')
        const style = source.slice(source.indexOf('<style'))
        const start = style.indexOf('.statsnav {')
        expect(start, 'the .statsnav block (guard)').toBeGreaterThan(-1)
        // The block up to the next top-level rule.
        const block = style.slice(start, style.indexOf('\n.statshead'))
        expect(block).toContain('btn-action')
        expect(block).not.toMatch(/pointer:\s*coarse/)
    })
})
