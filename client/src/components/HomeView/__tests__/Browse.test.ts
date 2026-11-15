import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Home's Browse Library block: the way to Albums and Artists, which have no
// navigation entry since 2026-11-14. Each card is a record crate: a count, a
// fan of up to twelve covers read through the list endpoint the pages use, and
// a front board labelled NEW IN or MOST PLAYED. A cover the server answers with
// its placeholder is not shown. How many covers fit is decided by the card's
// measured width (utils/crateFan.ts); jsdom measures 0, so every picture renders.

const { getAllItems, coverIsPlaceholder } = vi.hoisted(() => ({
    getAllItems: vi.fn(),
    coverIsPlaceholder: vi.fn(),
}))

vi.mock('@/requests/getall', () => ({ getAllItems }))
vi.mock('@/router', () => ({ Routes: { AlbumList: 'AlbumList', ArtistList: 'ArtistList' } }))
vi.mock('@/config', () => ({
    paths: { images: { thumb: { medium: '/img/thumbnail/medium/' }, artist: { medium: '/img/artist/medium/' } } },
}))
vi.mock('@/utils/colortools/placeholderCover', () => ({ coverIsPlaceholder }))

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

// Twenty distinct albums, for the cap.
const many = (n: number) => Array.from({ length: n }, (_, i) => ({ image: `album${i}.webp?pathhash=${i}` }))

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
        coverIsPlaceholder.mockReset()
        coverIsPlaceholder.mockResolvedValue(false)
    })

    it('links to the album and the artist list, and nothing else', () => {
        const links = mountBrowse().findAll('a').map(a => a.attributes('data-to'))
        expect(links).toEqual(['AlbumList', 'ArtistList'])
    })

    it('asks for sixteen of each: the newest albums, the most-played artists', async () => {
        mountBrowse()
        await flushPromises()
        expect(getAllItems).toHaveBeenCalledWith('albums', { start: 0, limit: 16, sortby: 'created_date', reverse: '1' })
        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 16, sortby: 'playcount', reverse: '1' })
    })

    it('shows the count and renders every fetched cover in the row', async () => {
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.count').text()).toBe(`${(1284).toLocaleString()} albums`)
        // jsdom measures no card, so every picture gets a slot; a real card decides by its width.
        expect(srcsOf(albums, '.covers img')).toEqual(ALBUM_ITEMS.map(it => '/img/thumbnail/medium/' + it.image))
        // One artist: singular, and a round row of one.
        expect(artists.find('.count').text()).toBe('1 artist')
        expect(artists.find('.covers').classes()).toContain('round')
        expect(artists.findAll('.covers img')).toHaveLength(1)
    })

    it('renders at most twelve covers, even if the endpoint sends more', async () => {
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 20, items: many(20) } } : ARTISTS)
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.findAll('.covers img')).toHaveLength(12)
    })

    it('does not render a picture the server answers with its placeholder', async () => {
        coverIsPlaceholder.mockImplementation((url: string) => Promise.resolve(url.includes('b1b2c3d4')))
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        const srcs = srcsOf(albums, '.covers img')
        expect(srcs).toHaveLength(ALBUM_ITEMS.length - 1)
        expect(srcs).not.toContain('/img/thumbnail/medium/b1b2c3d4e5f6a7b8.webp?pathhash=22')
        expect(coverIsPlaceholder).toHaveBeenCalledWith('/img/thumbnail/medium/a1b2c3d4e5f6a7b8.webp?pathhash=11')
    })

    it('fills the twelve from the placeholder-free rest of the sixteen', async () => {
        // The first four are placeholders: twelve real covers stand from positions five to sixteen.
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 16, items: many(16) } } : ARTISTS)
        )
        coverIsPlaceholder.mockImplementation((url: string) =>
            Promise.resolve(['album0.', 'album1.', 'album2.', 'album3.'].some(p => url.includes(p)))
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        const srcs = srcsOf(albums, '.covers img')
        expect(srcs).toHaveLength(12)
        expect(srcs[0]).toBe('/img/thumbnail/medium/album4.webp?pathhash=4')
        expect(srcs[11]).toBe('/img/thumbnail/medium/album15.webp?pathhash=15')
    })

    it('with only placeholders, the crate has no covers and no board', async () => {
        coverIsPlaceholder.mockResolvedValue(true)
        const [albums, artists] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.find('.name').text()).toBe('Albums')
        expect(albums.findAll('.covers').length).toBe(0)
        expect(albums.findAll('.board').length).toBe(0)
        expect(artists.findAll('.covers').length).toBe(0)
        expect(artists.findAll('.board').length).toBe(0)
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

        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 16, sortby: 'created_date', reverse: '1' })
        expect(srcsOf(artists, '.covers img')).toEqual(['/img/artist/medium/d1b2c3d4e5f6a7b8.webp'])
        expect(artists.find('.board .tag').text()).toBe('NEW IN')
    })

    it('never puts an unplayed artist under MOST PLAYED', async () => {
        // Two played, two never played: the playcount sort returns all four,
        // and the two at 0 plays are in arbitrary order. Only the played stand.
        const mixed = {
            status: 200,
            data: {
                total: 4,
                items: [
                    { image: 'p1.webp', help_text: '31 plays' },
                    { image: 'p2.webp', help_text: '1 play' },
                    { image: 'u1.webp', help_text: '0 plays' },
                    { image: 'u2.webp', help_text: '0 plays' },
                ],
            },
        }
        getAllItems.mockImplementation((type: string) => Promise.resolve(type === 'albums' ? ALBUMS : mixed))
        const wrapper = mountBrowse()
        await flushPromises()
        const [, artists] = wrapper.findAll('a')

        expect(srcsOf(artists, '.covers img')).toEqual(['/img/artist/medium/p1.webp', '/img/artist/medium/p2.webp'])
        expect(artists.find('.board .tag').text()).toBe('MOST PLAYED')
        expect(getAllItems).not.toHaveBeenCalledWith('artists', expect.objectContaining({ sortby: 'created_date' }))
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
