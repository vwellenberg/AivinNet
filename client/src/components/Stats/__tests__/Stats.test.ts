import { shallowMount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { describe, expect, it } from 'vitest'

import Stats from '@/components/Stats/Stats.vue'
import StatItem from '@/components/Stats/StatItem.vue'

// The order /logger/stats really sends — top track first, library count last.
const ITEMS = [
    { cssclass: 'toptrack', text: 'Top track this week', value: '19. Rittersleut - Unknown', image: 'abc.webp' },
    { cssclass: 'streams', text: 'this week', value: '139 track plays' },
    { cssclass: 'playtime', text: 'this week', value: '5 hrs, 54 mins listened' },
    { cssclass: 'favorites', text: 'this week', value: '7 new favorites' },
    { cssclass: 'trackcount', text: 'in your library', value: '12,560 tracks' },
]

describe('Stats', () => {
    it('lays every tile out in ONE row — the last one is not pushed to the far edge', async () => {
        const w = shallowMount(Stats, { props: { items: ITEMS } })
        await nextTick()

        const tiles = w.findAllComponents(StatItem)
        expect(tiles.map(t => t.props('icon'))).toEqual(ITEMS.map(i => i.cssclass))

        // The bug: the last tile sat in its own `.right` column behind a `1fr`
        // one, so on a wide window it drifted away from the rest of the row.
        const row = w.find('.statshead').element
        for (const tile of tiles) {
            expect(tile.element.parentElement).toBe(row)
        }
    })
})
