import { readFileSync } from 'fs'
import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'

// Home's Browse Library block: the way to Albums and Artists, which have no
// navigation entry since 2026-11-14. Each card is a record crate: a count, a
// fan of up to twelve covers read through the list endpoint the pages use, and
// a front board labelled NEW IN or MOST PLAYED. The list answer says per item
// whether the server has artwork for it (`has_artwork`); an item flagged false is
// not shown. How many covers fit is decided by the card's measured width
// (utils/crateFan.ts); jsdom measures 0, so every picture renders.

const { getAllItems } = vi.hoisted(() => ({ getAllItems: vi.fn() }))

vi.mock('@/requests/getall', () => ({ getAllItems }))
vi.mock('@/router', () => ({ Routes: { AlbumList: 'AlbumList', ArtistList: 'ArtistList' } }))
vi.mock('@/config', () => ({
    paths: { images: { thumb: { medium: '/img/thumbnail/medium/' }, artist: { medium: '/img/artist/medium/' } } },
}))

import Browse, { __resetBrowseCrates, NEW_IN_MIN, NEWEST_ALBUMS } from '@/components/HomeView/Browse.vue'

const RouterLink = { props: ['to'], template: '<a :data-to="to.name"><slot /></a>' }

// Shaped like GET /getall/<type>: album images carry the ?pathhash= suffix.
const ALBUM_ITEMS = [
    { image: 'a1b2c3d4e5f6a7b8.webp?pathhash=11', has_artwork: true },
    { image: 'b1b2c3d4e5f6a7b8.webp?pathhash=22', has_artwork: true },
    { image: 'c1b2c3d4e5f6a7b8.webp?pathhash=33', has_artwork: true },
    { image: 'd1b2c3d4e5f6a7b8.webp?pathhash=44', has_artwork: true },
    { image: 'e1b2c3d4e5f6a7b8.webp?pathhash=55', has_artwork: true },
    { image: 'f1b2c3d4e5f6a7b8.webp?pathhash=66', has_artwork: true },
    { image: '01b2c3d4e5f6a7b8.webp?pathhash=77', has_artwork: true },
]
const ALBUMS = { status: 200, data: { total: 1284, items: ALBUM_ITEMS } }
const ARTISTS = {
    status: 200,
    data: { total: 1, items: [{ image: 'd1b2c3d4e5f6a7b8.webp', help_text: '12 plays', has_artwork: true }] },
}

// Twenty distinct albums, for the cap.
const many = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ image: `album${i}.webp?pathhash=${i}`, has_artwork: true }))

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

    it('asks for the fifty newest albums, the most-played albums and the most-played artists', async () => {
        mountBrowse()
        await flushPromises()
        expect(getAllItems).toHaveBeenCalledWith('albums', { start: 0, limit: 50, sortby: 'created_date', reverse: '1', artwork: true })
        expect(getAllItems).toHaveBeenCalledWith('albums', { start: 0, limit: 16, sortby: 'playcount', reverse: '1', artwork: true })
        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 16, sortby: 'playcount', reverse: '1', artwork: true })
    })

    // The server answers `artwork` for up to ARTWORK_LIMIT_MAX items and 422s
    // above: a client asking for more would lose the whole crate.
    it('asks for no more newest albums than the server answers artwork for', () => {
        const py = readFileSync('../src/aivinnet/api/getall/__init__.py', 'utf8')
        const max = Number(/^ARTWORK_LIMIT_MAX = (\d+)$/m.exec(py)?.[1])
        expect(max).toBeGreaterThan(0)
        expect(NEWEST_ALBUMS).toBeLessThanOrEqual(max)
    })

    // Regression (2026-11-20, "loads quite late"): with only coverless albums in
    // front, the crate read four pages of the newest one after the other and
    // only then asked for the most-played: five round trips, each queued behind
    // Home's pictures. Both lists are asked for before either has answered.
    it('asks for the newest and the most-played albums at once, not one after the other', async () => {
        const pending: string[] = []
        getAllItems.mockImplementation((type: string, o: { sortby: string }) => {
            if (type === 'albums') pending.push(o.sortby)
            return new Promise(() => {}) // nothing answers
        })
        mountBrowse()
        await flushPromises()

        expect(pending.sort()).toEqual(['created_date', 'playcount'])
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

    it('reads the list flag and never probes a picture', async () => {
        const fetchSpy = vi.fn()
        vi.stubGlobal('fetch', fetchSpy)
        onTestFinished(() => {
            vi.unstubAllGlobals()
        })
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 16, items: many(16) } } : ARTISTS)
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.findAll('.covers img')).toHaveLength(12)
        // The count and the pictures come from the list requests (newest and
        // most-played albums, most-played artists), nothing else: no HEAD (or
        // any other request) per picture.
        expect(getAllItems).toHaveBeenCalledTimes(3)
        expect(fetchSpy).not.toHaveBeenCalled()
    })

    it('does not render a picture the server flags as having no artwork', async () => {
        const items = ALBUM_ITEMS.map(it => (it.image.startsWith('b1b2') ? { ...it, has_artwork: false } : it))
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 7, items } } : ARTISTS)
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        const srcs = srcsOf(albums, '.covers img')
        expect(srcs).toHaveLength(ALBUM_ITEMS.length - 1)
        expect(srcs).not.toContain('/img/thumbnail/medium/b1b2c3d4e5f6a7b8.webp?pathhash=22')
    })

    it('fills the twelve from the flagged-free rest of the sixteen', async () => {
        // The first four have no artwork: twelve real covers stand from positions five to sixteen.
        const items = many(16).map((it, i) => (i < 4 ? { ...it, has_artwork: false } : it))
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 16, items } } : ARTISTS)
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        const srcs = srcsOf(albums, '.covers img')
        expect(srcs).toHaveLength(12)
        expect(srcs[0]).toBe('/img/thumbnail/medium/album4.webp?pathhash=4')
        expect(srcs[11]).toBe('/img/thumbnail/medium/album15.webp?pathhash=15')
    })

    // Regression: 898 albums, the sixteen newest a batch without covers. The
    // crate read only that first page and stood empty beside its count.
    it('reads fifty newest albums back in one request', async () => {
        const all = many(64).map((it, i) => (i < 16 ? { ...it, has_artwork: false } : it))
        getAllItems.mockImplementation((type: string, o: { start: number; limit: number }) =>
            Promise.resolve(
                type === 'albums'
                    ? { status: 200, data: { total: 898, items: all.slice(o.start, o.start + o.limit) } }
                    : ARTISTS
            )
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        const srcs = srcsOf(albums, '.covers img')
        expect(srcs).toHaveLength(12)
        expect(srcs[0]).toBe('/img/thumbnail/medium/album16.webp?pathhash=16')
        expect(albums.find('.count').text()).toBe(`${(898).toLocaleString()} albums`)
        expect(albums.find('.tag').text()).toBe('NEW IN')
        // One request for the newest, from the top: no paging.
        const newest = getAllItems.mock.calls.filter(c => c[0] === 'albums' && c[1].sortby === 'created_date')
        expect(newest.map(c => [c[1].start, c[1].limit])).toEqual([[0, 50]])
    })

    it('keeps the fifty newest it asked for, even if the endpoint sends more', async () => {
        // The first fifty have no cover; the fifty-first has one, but was not asked for.
        const items = many(60).map((it, i) => (i < 50 ? { ...it, has_artwork: false } : it))
        getAllItems.mockImplementation((type: string, o: { sortby: string }) => {
            if (type !== 'albums') return Promise.resolve(ARTISTS)
            if (o.sortby === 'playcount') return Promise.resolve({ status: 200, data: { total: 60, items: [] } })
            return Promise.resolve({ status: 200, data: { total: 60, items } })
        })
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.findAll('.covers').length).toBe(0)
    })

    // Regression: 176 DS9 episodes, each its own coverless album, stood in front
    // of every other album; four pages back still found no cover.
    it('shows the most-played albums when none of the newest has a cover', async () => {
        const coverless = many(64).map(it => ({ ...it, has_artwork: false }))
        const top = [
            { image: 'top0.webp?pathhash=1', help_text: '40 plays', has_artwork: true },
            { image: 'top1.webp?pathhash=2', help_text: '9 plays', has_artwork: false },
            { image: 'top2.webp?pathhash=3', help_text: '3 plays', has_artwork: true },
            { image: 'top3.webp?pathhash=4', help_text: '0 plays', has_artwork: true },
        ]
        getAllItems.mockImplementation((type: string, o: { start: number; limit: number; sortby: string }) => {
            if (type !== 'albums') return Promise.resolve(ARTISTS)
            if (o.sortby === 'playcount') return Promise.resolve({ status: 200, data: { total: 898, items: top } })
            return Promise.resolve({ status: 200, data: { total: 898, items: coverless.slice(o.start, o.start + o.limit) } })
        })
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        // Played and with a cover: not the coverless one, not the unplayed one.
        expect(srcsOf(albums, '.covers img')).toEqual([
            '/img/thumbnail/medium/top0.webp?pathhash=1',
            '/img/thumbnail/medium/top2.webp?pathhash=3',
        ])
        expect(albums.find('.tag').text()).toBe('MOST PLAYED')
        expect(albums.find('.count').text()).toBe(`${(898).toLocaleString()} albums`)
        // One request each: the newest from the top, the most-played beside it.
        expect(getAllItems.mock.calls.filter(c => c[0] === 'albums')).toHaveLength(2)
    })

    // Regression (2026-11-22): one new album with a cover among coverless ones
    // put a lone sleeve under NEW IN while 900 albums stood behind it. NEW IN
    // needs NEW_IN_MIN covers among the newest; below that, MOST PLAYED.
    describe('NEW IN needs at least three new covers', () => {
        const TOP = [
            { image: 'top0.webp?pathhash=1', help_text: '40 plays', has_artwork: true },
            { image: 'top1.webp?pathhash=2', help_text: '3 plays', has_artwork: true },
        ]
        const newestWith = (covers: number) =>
            many(50).map((it, i) => (i < covers ? it : { ...it, has_artwork: false }))

        function serve(newest: object[], top: object[]) {
            getAllItems.mockImplementation((type: string, o: { sortby: string }) => {
                if (type !== 'albums') return Promise.resolve(ARTISTS)
                const items = o.sortby === 'playcount' ? top : newest
                return Promise.resolve({ status: 200, data: { total: 900, items } })
            })
        }

        it('is three', () => {
            expect(NEW_IN_MIN).toBe(3)
        })

        it.each([1, 2])('shows MOST PLAYED with %i new cover(s)', async covers => {
            serve(newestWith(covers), TOP)
            const [albums] = mountBrowse().findAll('a')
            await flushPromises()

            expect(albums.find('.tag').text()).toBe('MOST PLAYED')
            expect(srcsOf(albums, '.covers img')).toEqual(TOP.map(it => '/img/thumbnail/medium/' + it.image))
            expect(albums.find('.count').text()).toBe(`${(900).toLocaleString()} albums`)
        })

        it('shows NEW IN with exactly three new covers', async () => {
            serve(newestWith(3), TOP)
            const [albums] = mountBrowse().findAll('a')
            await flushPromises()

            expect(albums.find('.tag').text()).toBe('NEW IN')
            expect(srcsOf(albums, '.covers img')).toEqual(
                many(3).map(it => '/img/thumbnail/medium/' + it.image)
            )
        })

        it('keeps the few new covers under NEW IN when no played album has one', async () => {
            serve(newestWith(2), [{ image: 'u.webp?pathhash=9', help_text: '0 plays', has_artwork: true }])
            const [albums] = mountBrowse().findAll('a')
            await flushPromises()

            expect(albums.find('.tag').text()).toBe('NEW IN')
            expect(albums.findAll('.covers img')).toHaveLength(2)
        })
    })

    it('keeps NEW IN without covers when the most-played albums have none either', async () => {
        const coverless = many(50).map(it => ({ ...it, has_artwork: false }))
        getAllItems.mockImplementation((type: string, o: { sortby: string }) => {
            if (type !== 'albums') return Promise.resolve(ARTISTS)
            if (o.sortby === 'playcount') return Promise.resolve({ status: 500, data: null, error: 'boom' })
            return Promise.resolve({ status: 200, data: { total: 50, items: coverless } })
        })
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        // The count still stands; there is just nothing to show in the crate.
        expect(albums.find('.count').text()).toBe('50 albums')
        expect(albums.findAll('.covers').length).toBe(0)
        expect(albums.findAll('.board').length).toBe(0)
    })

    it('with only has_artwork false, the crate has no covers and no board', async () => {
        const none = (items: { image: string }[]) => items.map(it => ({ ...it, has_artwork: false }))
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(
                type === 'albums'
                    ? { status: 200, data: { total: 7, items: none(ALBUM_ITEMS) } }
                    : { status: 200, data: { total: 1, items: none(ARTISTS.data.items) } }
            )
        )
        const [albums, artists] = mountBrowse().findAll('a')
        await flushPromises()

        expect(albums.find('.name').text()).toBe('Albums')
        expect(albums.findAll('.covers').length).toBe(0)
        expect(albums.findAll('.board').length).toBe(0)
        expect(artists.findAll('.covers').length).toBe(0)
        expect(artists.findAll('.board').length).toBe(0)
    })

    it('keeps an item that has no has_artwork field (an older server)', async () => {
        const legacy = ALBUM_ITEMS.map(({ image }) => ({ image }))
        getAllItems.mockImplementation((type: string) =>
            Promise.resolve(type === 'albums' ? { status: 200, data: { total: 7, items: legacy } } : ARTISTS)
        )
        const [albums] = mountBrowse().findAll('a')
        await flushPromises()

        expect(srcsOf(albums, '.covers img')).toEqual(legacy.map(it => '/img/thumbnail/medium/' + it.image))
    })

    it('labels the board NEW IN for albums and MOST PLAYED for artists with plays', async () => {
        const wrapper = mountBrowse()
        await flushPromises()
        const [albums, artists] = wrapper.findAll('a')

        expect(albums.find('.board .tag').text()).toBe('NEW IN')
        expect(artists.find('.board .tag').text()).toBe('MOST PLAYED')
    })

    it('labels the artist board NEW IN while the fallback to newest is in use', async () => {
        const unplayed = {
            status: 200,
            data: {
                total: 2,
                items: [
                    { image: 'x.webp', help_text: '0 plays', has_artwork: true },
                    { image: 'y.webp', help_text: '0 plays', has_artwork: true },
                ],
            },
        }
        getAllItems.mockImplementation((type: string, o: { sortby: string }) =>
            Promise.resolve(type === 'albums' ? ALBUMS : o.sortby === 'playcount' ? unplayed : ARTISTS)
        )
        const wrapper = mountBrowse()
        await flushPromises()
        const [, artists] = wrapper.findAll('a')

        expect(getAllItems).toHaveBeenCalledWith('artists', { start: 0, limit: 16, sortby: 'created_date', reverse: '1', artwork: true })
        expect(srcsOf(artists, '.covers img')).toEqual(['/img/artist/medium/d1b2c3d4e5f6a7b8.webp'])
        expect(artists.find('.board .tag').text()).toBe('NEW IN')
    })

    it('falls back to the newest artists when no played artist has a picture', async () => {
        // Artist images come from an online lookup: the two played ones may have none.
        // Picking them first and filtering after left the crate empty.
        const playedWithoutPictures = {
            status: 200,
            data: {
                total: 2,
                items: [
                    { image: 'p1.webp', help_text: '31 plays', has_artwork: false },
                    { image: 'p2.webp', help_text: '1 play', has_artwork: false },
                ],
            },
        }
        getAllItems.mockImplementation((type: string, o: { sortby: string }) =>
            Promise.resolve(type === 'albums' ? ALBUMS : o.sortby === 'playcount' ? playedWithoutPictures : ARTISTS)
        )
        const wrapper = mountBrowse()
        await flushPromises()
        const [, artists] = wrapper.findAll('a')

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
                    { image: 'p1.webp', help_text: '31 plays', has_artwork: true },
                    { image: 'p2.webp', help_text: '1 play', has_artwork: true },
                    { image: 'u1.webp', help_text: '0 plays', has_artwork: true },
                    { image: 'u2.webp', help_text: '0 plays', has_artwork: true },
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
