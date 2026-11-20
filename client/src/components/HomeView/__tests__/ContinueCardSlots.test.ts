import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

// The "Up next" column is there from the first frame (#776): its slots exist
// before any track has arrived, so the card does not grow when they do. Two of
// them since 2026-11-20: two rows stand level with the title and the ▶ row.
const { getAlbumTracks } = vi.hoisted(() => ({ getAlbumTracks: vi.fn() }))

vi.mock('@/requests/album', () => ({ getAlbumTracks }))
vi.mock('@/requests/playlists', () => ({ getPlaylist: vi.fn(async () => ({ tracks: [] })) }))
vi.mock('@/helpers/usePlayFrom', () => ({ playAlbumAt: vi.fn(), playPlaylistAt: vi.fn(), resumeIndex: () => 0 }))
vi.mock('@/helpers/continueDismiss', () => ({ removeFromContinue: vi.fn() }))
// The look decides whether the cover's colour is read at all (Boring tints the card with it).
const { settings, setColorsToStore } = vi.hoisted(() => ({
    settings: { look: 'memphis' },
    setColorsToStore: vi.fn((store: { colors: { bg: string } }, _url: string) => {
        store.colors.bg = '#3a2f1c'
    }),
}))
vi.mock('@/stores/settings', () => ({ default: () => settings }))
vi.mock('@/utils/colortools/setColorsToStore', () => ({ default: setColorsToStore }))

import ContinueCard from '@/components/HomeView/ContinueCard.vue'

const entry = {
    type: 'album',
    item: {
        albumhash: 'a0000000000000pr',
        title: 'Album',
        image: 'a0000000000000pr.webp?pathhash=1f3c9d',
        track_index: 1,
        track_total: 5,
        time: '20 min',
    },
    dismiss: { type: 'album', hash: 'a0000000000000pr' },
}

const stubs = { RouterLink: { props: ['to'], template: '<a><slot /></a>' } }

describe('ContinueCard: up next holds its space from the first frame (#776)', () => {
    it('renders the column with two slots before its tracks have arrived', () => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })

        expect(w.find('.up-next').exists()).toBe(true)
        expect(w.findAll('.up-next > li').length - 1, 'two slots after the caption').toBe(2)
        expect(w.findAll('.next-slot-empty')).toHaveLength(2)
        expect(w.findAll('.next-row')).toHaveLength(0)
    })

    it('fills the same two slots when the tracks arrive, without adding any', async () => {
        const track = (n: number) => ({ trackhash: `t${n}`, title: `Track ${n}`, artists: [], duration: 200 })
        getAlbumTracks.mockResolvedValue([track(1), track(2), track(3), track(4), track(5)])

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()

        expect(w.findAll('.up-next > li').length - 1).toBe(2)
        expect(w.findAll('.next-row')).toHaveLength(2)
        expect(w.findAll('.next-slot-empty')).toHaveLength(0)
    })

    it('hides the column when the load answers with no tracks', async () => {
        getAlbumTracks.mockResolvedValue([])

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()

        expect(w.find('.up-next').classes()).toContain('up-next-none')
    })

    it('reads no cover colour under Memphis, which paints the entity pastel', async () => {
        settings.look = 'memphis'
        setColorsToStore.mockClear()
        getAlbumTracks.mockResolvedValue([])
        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()
        expect(setColorsToStore).not.toHaveBeenCalled()
        expect(w.find('.continue-card').attributes('style') ?? '').not.toContain('--card-tint')
    })

    it('tints the card from its cover under Boring', async () => {
        settings.look = 'stream'
        setColorsToStore.mockClear()
        getAlbumTracks.mockResolvedValue([])
        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()
        expect(setColorsToStore).toHaveBeenCalledTimes(1)
        expect(setColorsToStore.mock.calls[0][1]).toContain('a0000000000000pr.webp?pathhash=1f3c9d')
        expect(w.find('.continue-card').attributes('style')).toContain('--card-tint: #3a2f1c')
        settings.look = 'memphis'
    })
})

describe('ContinueCard: three short lines (2026-11-20)', () => {
    it('puts the time in the caption and the position at the end of the bar', () => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))
        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })

        expect(w.find('.info .kicker').text()).toBe('Continue · 20 min')
        expect(w.find('.meta').text()).toBe('2/5')
        expect(w.find('.progress').attributes('aria-label')).toBe('Track 2 of 5')
    })

    it('leaves the time out of the caption when the server sends none', () => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))
        const bare = { ...entry, item: { ...entry.item, time: undefined } }
        const w = mount(ContinueCard, { props: { entry: bare }, global: { stubs } })

        expect(w.find('.info .kicker').text()).toBe('Continue')
    })

    it('names the ▶ for screen readers, now that it carries no label', () => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))
        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })

        const resume = w.find('button.resume')
        expect(resume.text()).toBe('')
        expect(resume.attributes('aria-label')).toBe('Continue album Album')
    })
})

describe('ContinueCard: a line under the title (2026-11-20)', () => {
    const mountWith = (over: Record<string, unknown>, type = 'album') => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))
        const e = { ...entry, type, item: { ...entry.item, ...over } }
        return mount(ContinueCard, { props: { entry: e }, global: { stubs } })
    }

    it('names an album by its artists, year and the time left', () => {
        const w = mountWith({
            albumartists: [{ name: 'Velvet Orchard', artisthash: 'a1' }, { name: 'Ondine Sky', artisthash: 'a2' }],
            year: 2019,
            remaining: 38 * 60,
        })
        expect(w.find('.sub').text()).toBe('Velvet Orchard, Ondine Sky · 2019 · 38 min left')
    })

    it('says playlist, its songs and the time left', () => {
        const w = mountWith({ id: '7', name: 'Road trip', track_total: 24, remaining: 72 * 60 }, 'playlist')
        expect(w.find('.sub').text()).toBe('Playlist · 24 songs · 1 h 12 min left')
    })

    it('leaves out what the server does not send (an untagged album, an older server)', () => {
        const w = mountWith({ albumartists: [{ name: 'Velvet Orchard', artisthash: 'a1' }], year: null })
        expect(w.find('.sub').text()).toBe('Velvet Orchard')
    })

    it('draws no empty line when there is nothing to say', () => {
        const w = mountWith({})
        expect(w.find('.sub').exists()).toBe(false)
    })
})
