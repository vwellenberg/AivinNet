import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Settings → Home, "Not interested" (#531): the marks, and taking one back.
const { getNotInterested, unmarkNotInterested, refreshIfLoaded, showError } = vi.hoisted(() => ({
    getNotInterested: vi.fn(),
    unmarkNotInterested: vi.fn(),
    refreshIfLoaded: vi.fn(),
    showError: vi.fn(),
}))

vi.mock('@/requests/home', () => ({ getNotInterested, unmarkNotInterested }))
vi.mock('@/stores/home', () => ({ default: () => ({ refreshIfLoaded }) }))
vi.mock('@/stores/notification', () => ({ useToast: () => ({ showError }) }))

import NotInterested from '@/components/modals/settings/custom/NotInterested.vue'

// As GET /nothome/not-interested sends them: newest first, the image with its
// suffix, and one item that has left the library.
const ITEMS = [
    { type: 'artist', hash: 'b0000000000000mi', timestamp: 3, title: 'Miles Davis', subtitle: null, image: 'b0000000000000mi.webp' },
    {
        type: 'album',
        hash: 'a0000000000000pr',
        timestamp: 2,
        title: 'Frizzle Fry',
        subtitle: 'Primus',
        image: 'a0000000000000pr.webp?pathhash=ph-Frizzle Fry',
    },
    { type: 'album', hash: 'a0000000000000go', timestamp: 1, title: null, subtitle: null, image: null },
]

const mounted: ReturnType<typeof mount>[] = []

async function panel() {
    const w = mount(NotInterested, { attachTo: document.body })
    mounted.push(w)
    await flushPromises()
    return w
}

const titles = (w: ReturnType<typeof mount>) => w.findAll('.not-interested-title').map(t => t.text())

beforeEach(() => {
    getNotInterested.mockReset().mockResolvedValue({ status: 200, data: { items: ITEMS } })
    unmarkNotInterested.mockReset().mockResolvedValue({ status: 200, data: { msg: 'Removed' } })
    refreshIfLoaded.mockReset()
    showError.mockReset()
})

afterEach(() => {
    mounted.splice(0).forEach(w => w.unmount())
})

describe('Settings → Home: Not interested', () => {
    it('lists every mark with what it is and where it was hidden', async () => {
        const w = await panel()

        expect(titles(w)).toEqual(['Miles Davis', 'Frizzle Fry', 'No longer in your library'])
        expect(w.findAll('.not-interested-desc').map(d => d.text())).toEqual([
            'Artist · Artists you might like',
            'Album by Primus · Never played',
            'Album · Never played',
        ])
        const images = w.findAll('img').map(i => i.attributes('src'))
        expect(images).toHaveLength(2)
        expect(images[0]).toContain('b0000000000000mi.webp')
        expect(images[1]).toContain('a0000000000000pr.webp?pathhash=ph-Frizzle Fry')
    })

    it('takes a mark back and has Home refreshed', async () => {
        const w = await panel()

        await w.find('[aria-label="Suggest Frizzle Fry again"]').trigger('click')
        await flushPromises()

        expect(unmarkNotInterested).toHaveBeenCalledWith('album', 'a0000000000000pr')
        expect(titles(w)).toEqual(['Miles Davis', 'No longer in your library'])
        expect(refreshIfLoaded).toHaveBeenCalled()
    })

    it('keeps the mark listed when the server refuses to take it back', async () => {
        unmarkNotInterested.mockResolvedValue({ status: 500, data: null })
        const w = await panel()

        await w.find('[aria-label="Suggest Miles Davis again"]').trigger('click')
        await flushPromises()

        expect(showError).toHaveBeenCalled()
        expect(titles(w)).toHaveLength(3)
        expect(refreshIfLoaded).not.toHaveBeenCalled()
    })

    it('says how to hide something while nothing is', async () => {
        getNotInterested.mockResolvedValue({ status: 200, data: { items: [] } })

        const w = await panel()

        expect(w.text()).toContain('Nothing hidden')
        expect(w.findAll('.not-interested-row')).toHaveLength(0)
    })

    it('says so when the list cannot be loaded', async () => {
        getNotInterested.mockResolvedValue({ status: 500, data: null })

        const w = await panel()

        expect(w.text()).toContain('could not be loaded')
        expect(w.text()).not.toContain('Nothing hidden')
    })
})
