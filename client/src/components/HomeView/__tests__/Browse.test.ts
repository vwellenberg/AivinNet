import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Home's Browse Library block: the way to Albums and Artists, which have no
// navigation entry since 2026-11-14. Each card is a record crate: a count, a
// row of up to seven covers read through the list endpoint the pages use, and
// a front board labelled NEW IN or MOST PLAYED. How many covers show is CSS
// (container queries), so the census here checks what is rendered, not shown.

const { getAllItems } = vi.hoisted(() => ({ getAllItems: vi.fn() }))

vi.mock('@/requests/getall', () => ({ getAllItems }))
vi.mock('@/router', () => ({ Routes: { AlbumList: 'AlbumList', ArtistList: 'ArtistList' } }))
vi.mock('@/config', () => ({
    paths: { images: { thumb: { medium: '/img/thumbnail/medium/' }, artist: { medium: '/img/artist/medium/' } } },
}))

import Browse, { __resetBrowseCrates } from '@/components/HomeView/Browse.vue'

const RouterLink = { props: ['to'], template: '<a :data-to="to.name"><slot /></a>' }

// Shaped like GET /getall/<type>: album images carry the ?pathhash= suffix.
const ALBUM_ITEMS = [
    { image: 'a1b2c3d4e5f6a7b8.webp?pathhash=11' },
    { image: 'b1b2c3d4e5f6a7b8.webp?pathhash=22' },
    { image: 'c1b2c3d4e5f6a7b8.webp?pathhash=33' },
    { image: 'd1b2c3d4e5f6a7b8.webp?pathhash=44' },
    { image: 'e1b2c3d4e5f6a7b8.webp?pathhash=55' },
    { image: 'f1b2c3d4e5f6a7b8.webp?pathhash=66' },
    { image: '01b2c3d4e5f6a7b8.webp?pathhash=77' },
]
const ALBUMS = { status: 200, data: { total: 1284, items: ALBUM_ITEMS } }
const ARTISTS = { status: 200, data: { total: 1, items: [{ image: 'd1b2c3d4e5f6a7b8.webp', help_text: '12 plays' }] } }

function mountBrowse() {
    return mount(Browse, { global: { stubs: { RouterLink } } })
}

function srcsOf(card: { findAll: (s: string) => { attributes: (n: string) => string | undefined }[] }, sel: string) {
    return card.findAll(sel).map(i => i.attributes('src'))
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

    it('asks for seven of each: the newest albums, the most-played artists', async () => {
        mountBrowse()
        await flushPromises()
        expect(getAllItems).toHaveBeenCalledWith('albums', { start: 0, limit: 7, sortby: 'created_date', reverse: '1' })
        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 7, sortby: 'playcount', reverse: '1' })
    })

    it('shows the count and renders every fetched cover in the row', async () => {
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.count').text()).toBe(`${(1284).toLocaleString()} albums`)
        // All seven are in the DOM; the card's width hides the ones it cannot fit.
        expect(srcsOf(albums, '.covers img')).toEqual(ALBUM_ITEMS.map(it => '/img/thumbnail/medium/' + it.image))
        // One artist: singular, and a round row of one.
        expect(artists.find('.count').text()).toBe('1 artist')
        expect(artists.find('.covers').classes()).toContain('round')
        expect(artists.findAll('.covers img')).toHaveLength(1)
    })

    it('renders at most seven covers, even if the endpoint sends more', async () => {
        const nine = { status: 200, data: { total: 9, items: [...ALBUM_ITEMS, { image: 'g.webp' }, { image: 'h.webp' }] } }
        getAllItems.mockImplementation((type: string) => Promise.resolve(type === 'albums' ? nine : ARTISTS))
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.findAll('.covers img')).toHaveLength(7)
    })

    it('labels the board NEW IN for albums and MOST PLAYED for artists with plays', async () => {
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.board .tag').text()).toBe('NEW IN')
        expect(artists.find('.board .tag').text()).toBe('MOST PLAYED')
    })

    it('labels the artist board NEW IN while the fallback to newest is in use', async () => {
        const unplayed = { status: 200, data: { total: 2, items: [{ image: 'x.webp', help_text: '0 plays' }, { image: 'y.webp', help_text: '0 plays' }] } }
        getAllItems.mockImplementation((type: string, o: { sortby: string }) =>
            Promise.resolve(type === 'albums' ? ALBUMS : o.sortby === 'playcount' ? unplayed : ARTISTS)
        )
        const wrapper = mountBrowse()
        await flushPromises()
        const [, artists] = wrapper.findAll('a')

        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 7, sortby: 'created_date', reverse: '1' })
        expect(srcsOf(artists, '.covers img')).toEqual(['/img/artist/medium/d1b2c3d4e5f6a7b8.webp'])
        expect(artists.find('.board .tag').text()).toBe('NEW IN')
    })

    it('stays a working link with just its name when the request fails, and has no board', async () => {
        getAllItems.mockResolvedValue({ status: 500, data: null, error: 'boom' })
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.name').text()).toBe('Albums')
        expect(albums.find('.count').exists()).toBe(false)
        expect(albums.find('.covers').exists()).toBe(false)
        expect(albums.find('.board').exists()).toBe(false)
        expect(artists.find('.board').exists()).toBe(false)
    })

    it('loads once per session: a return to Home reuses what it has', async () => {
        mountBrowse()
        await flushPromises()
        getAllItems.mockClear()

        const again = mountBrowse()
        expect(getAllItems).not.toHaveBeenCalled()
        expect(again.findAll('a')[0].find('.count').exists()).toBe(true)
        expect(again.findAll('a')[1].find('.board .tag').text()).toBe('MOST PLAYED')
    })
})
