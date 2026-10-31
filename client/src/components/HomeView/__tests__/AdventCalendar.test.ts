import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, h } from 'vue'

const { getAdvent } = vi.hoisted(() => ({ getAdvent: vi.fn() }))

vi.mock('@/requests/home', () => ({ getAdvent }))
// The shared album card has its own tests; here it only shows which album it got.
vi.mock('@/components/shared/AlbumCard.vue', () => ({
    default: defineComponent({
        props: { album: { type: Object, required: true } },
        setup(props) {
            return () => h('div', { class: 'album-card-stub' }, props.album.title)
        },
    }),
}))

import AdventCalendar from '@/components/HomeView/AdventCalendar.vue'
import { ADVENT_DOORS } from '@/utils/advent'

const YEAR = new Date().getFullYear()
const STORAGE_KEY = `aivinnet.advent.${YEAR}`

// As GET /nothome/advent sends it on the 5th of December: five doors, realistic album objects.
function calendar(day: number) {
    return {
        day,
        doors: Array.from({ length: day }, (_, i) => ({
            day: i + 1,
            album: {
                albumhash: `album${i + 1}`,
                title: `Album ${i + 1}`,
                image: `album${i + 1}.webp?pathhash=ph-album${i + 1}`,
                albumartists: [{ name: 'Artist', artisthash: 'a1' }],
                versions: [],
            },
        })),
    }
}

async function card(body: unknown, status = 200) {
    getAdvent.mockResolvedValue({ status, data: body })
    const w = mount(AdventCalendar)
    await flushPromises()
    return w
}

const doors = (w: ReturnType<typeof mount>) => w.findAll('.advent-door')

beforeEach(() => {
    getAdvent.mockReset()
    localStorage.clear()
})

describe('AdventCalendar on Home', () => {
    it('shows all 24 doors, with today highlighted and the future locked', async () => {
        const w = await card(calendar(5))

        expect(w.find('.advent-card').exists()).toBe(true)
        expect(doors(w)).toHaveLength(ADVENT_DOORS)
        expect(doors(w)[4].classes()).toContain('is-today')
        expect(doors(w)[3].classes()).not.toContain('is-today')
        // Doors 1 to 5 can be pressed; 6 to 24 are locked (disabled).
        expect(doors(w)[4].attributes('disabled')).toBeUndefined()
        expect(doors(w)[5].attributes('disabled')).toBeDefined()
        expect(doors(w)[23].classes()).toContain('is-locked')
    })

    it('shows no card outside December 1 to 24', async () => {
        const w = await card({ day: 0, doors: [] })

        expect(w.find('.advent-card').exists()).toBe(false)
    })

    it('shows no card when the server cannot answer', async () => {
        const w = await card(null, 500)

        expect(w.find('.advent-card').exists()).toBe(false)
    })

    it('opens a door on press and shows that day’s album as a card', async () => {
        const w = await card(calendar(5))
        expect(w.find('.album-card-stub').exists()).toBe(false)

        await doors(w)[2].trigger('click')

        expect(doors(w)[2].classes()).toContain('is-open')
        expect(doors(w)[2].attributes('aria-pressed')).toBe('true')
        expect(w.find('.album-card-stub').text()).toBe('Album 3')
    })

    it('remembers opened doors on this device, and opens today’s again on reload', async () => {
        const first = await card(calendar(5))
        await doors(first)[4].trigger('click')
        expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')).toEqual([5])

        const again = await card(calendar(5))

        expect(doors(again)[4].classes()).toContain('is-open')
        expect(again.find('.album-card-stub').text()).toBe('Album 5')
    })

    it('starts closed when storage holds nothing usable', async () => {
        localStorage.setItem(STORAGE_KEY, '{not json')

        const w = await card(calendar(5))

        expect(doors(w).some(d => d.classes().includes('is-open'))).toBe(false)
    })

    it('does not open a locked door even if it is called', async () => {
        const w = await card(calendar(5))
        // A locked door is disabled, so the press never reaches the handler.
        await doors(w)[9].trigger('click')

        expect(doors(w)[9].classes()).not.toContain('is-open')
        expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
    })
})
