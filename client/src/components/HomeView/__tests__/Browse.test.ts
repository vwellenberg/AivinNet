import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Home's Browse Library block: the way to Albums and Artists, which have no
// navigation entry since 2026-11-14. Each card shows a count and a fan of
// three pictures, read through the list endpoint the pages use.

const { getAllItems } = vi.hoisted(() => ({ getAllItems: vi.fn() }))

vi.mock('@/requests/getall', () => ({ getAllItems }))
vi.mock('@/router', () => ({ Routes: { AlbumList: 'AlbumList', ArtistList: 'ArtistList' } }))
vi.mock('@/config', () => ({
    paths: { images: { thumb: { medium: '/img/thumbnail/medium/' }, artist: { medium: '/img/artist/medium/' } } },
}))

import Browse, { __resetBrowseCrates } from '@/components/HomeView/Browse.vue'

const RouterLink = { props: ['to'], template: '<a :data-to="to.name"><slot /></a>' }

// Shaped like GET /getall/<type>: album images carry the ?pathhash= suffix.
const ALBUMS = {
    status: 200,
    data: {
        total: 1284,
        items: [
            { image: 'a1b2c3d4e5f6a7b8.webp?pathhash=11' },
            { image: 'b1b2c3d4e5f6a7b8.webp?pathhash=22' },
            { image: 'c1b2c3d4e5f6a7b8.webp?pathhash=33' },
        ],
    },
}
const ARTISTS = { status: 200, data: { total: 1, items: [{ image: 'd1b2c3d4e5f6a7b8.webp', help_text: '12 plays' }] } }

function mountBrowse() {
    return mount(Browse, { global: { stubs: { RouterLink } } })
}

describe('Browse Library', () => {
    beforeEach(() => {
        __resetBrowseCrates()
        getAllItems.mockReset()
        getAllItems.mockImplementation((type: string) => Promise.resolve(type === 'albums' ? ALBUMS : ARTISTS))
    })

    it('links to the album and the artist list, and nothing else', () => {
        const links = mountBrowse().findAll('a').map(a => a.attributes('data-to'))
        expect(links).toEqual(['AlbumList', 'ArtistList'])
    })

    it('asks for three of each: the newest albums, the most-played artists', async () => {
        mountBrowse()
        await flushPromises()
        expect(getAllItems).toHaveBeenCalledWith('albums', { start: 0, limit: 3, sortby: 'created_date', reverse: '1' })
        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 3, sortby: 'playcount', reverse: '1' })
    })

    it('shows the count and fans the pictures out', async () => {
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.count').text()).toBe(`${(1284).toLocaleString()} albums`)
        expect(albums.findAll('.fan img').map(i => i.attributes('src'))).toEqual(
            ALBUMS.data.items.map(it => '/img/thumbnail/medium/' + it.image)
        )
        // One artist: singular, and a round fan of one.
        expect(artists.find('.count').text()).toBe('1 artist')
        expect(artists.find('.fan').classes()).toContain('round')
        expect(artists.findAll('.fan img')).toHaveLength(1)
    })

    it('stays a working link with just its name when the request fails', async () => {
        getAllItems.mockResolvedValue({ status: 500, data: null, error: 'boom' })
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums] = wrapper.findAll('a')

        expect(albums.find('.name').text()).toBe('Albums')
        expect(albums.find('.count').exists()).toBe(false)
        expect(albums.find('.fan').exists()).toBe(false)
    })

    it('falls back to the newest artists while nothing has been played', async () => {
        const unplayed = { status: 200, data: { total: 2, items: [{ image: 'x.webp', help_text: '0 plays' }, { image: 'y.webp', help_text: '0 plays' }] } }
        getAllItems.mockImplementation((type: string, o: { sortby: string }) =>
            Promise.resolve(type === 'albums' ? ALBUMS : o.sortby === 'playcount' ? unplayed : ARTISTS)
        )
        const wrapper = mountBrowse()
        await flushPromises()

        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 3, sortby: 'created_date', reverse: '1' })
        expect(wrapper.findAll('a')[1].findAll('.fan img').map(i => i.attributes('src'))).toEqual([
            '/img/artist/medium/d1b2c3d4e5f6a7b8.webp',
        ])
    })

    it('loads once per session: a return to Home reuses what it has', async () => {
        mountBrowse()
        await flushPromises()
        getAllItems.mockClear()

        const again = mountBrowse()
        expect(getAllItems).not.toHaveBeenCalled()
        expect(again.findAll('a')[0].find('.count').exists()).toBe(true)
    })
})
