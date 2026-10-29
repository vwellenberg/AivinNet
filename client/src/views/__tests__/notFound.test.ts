import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/requests/home', () => ({ getSurpriseAlbum: vi.fn() }))
vi.mock('@/helpers/usePlayFrom', () => ({ playFromAlbumCard: vi.fn() }))
vi.mock('@/router', () => ({ Routes: { Home: 'Home' } }))

import NotFound from '@/views/NotFound.vue'
import { getSurpriseAlbum } from '@/requests/home'
import { playFromAlbumCard } from '@/helpers/usePlayFrom'

const stubs = { RouterLink: { props: ['to'], template: '<a :data-to="JSON.stringify(to)"><slot /></a>' } }

function page() {
    return mount(NotFound, { global: { stubs } })
}

beforeEach(() => {
    vi.mocked(getSurpriseAlbum).mockReset()
    vi.mocked(playFromAlbumCard).mockReset()
})

describe('NotFound: Lost in Subspace (#546)', () => {
    it('says the signal does not come through', () => {
        const w = page()

        expect(w.find('h1').text()).toBe('Lost in Subspace')
        expect(w.text()).toContain("This signal doesn't come through.")
    })

    it('keeps the text on a plate, not on the bare ground', () => {
        const w = page()

        expect(w.find('.lost-plate').exists()).toBe(true)
        expect(w.find('.lost-plate').find('h1').exists()).toBe(true)
    })

    it('links back to Home', () => {
        const w = page()
        const link = w.find('.lost-home')

        expect(link.text()).toContain('Back to Home')
        expect(JSON.parse(link.attributes('data-to')!)).toEqual({ name: 'Home' })
    })

    it('Surprise me asks the existing request helper and plays what it returns', async () => {
        vi.mocked(getSurpriseAlbum).mockResolvedValue('abc123hash')
        const w = page()

        const button = w.find('button')
        expect(button.text()).toContain('Surprise me')
        await button.trigger('click')
        await flushPromises()

        expect(getSurpriseAlbum).toHaveBeenCalledTimes(1)
        expect(playFromAlbumCard).toHaveBeenCalledWith('abc123hash', '')
    })

    it('plays nothing when the server has no album to offer', async () => {
        vi.mocked(getSurpriseAlbum).mockResolvedValue(null)
        const w = page()

        await w.find('button').trigger('click')
        await flushPromises()

        expect(getSurpriseAlbum).toHaveBeenCalledTimes(1)
        expect(playFromAlbumCard).not.toHaveBeenCalled()
    })

    it('hides the decoration from screen readers', () => {
        const w = page()

        expect(w.find('.lost-shapes').attributes('aria-hidden')).toBe('true')
    })
})
