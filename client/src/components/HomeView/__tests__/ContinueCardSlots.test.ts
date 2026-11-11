import { flushPromises, mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

// The "Up next" column is there from the first frame (#776): its three slots
// exist before any track has arrived, so the card does not grow when they do.
const { getAlbumTracks } = vi.hoisted(() => ({ getAlbumTracks: vi.fn() }))

vi.mock('@/requests/album', () => ({ getAlbumTracks }))
vi.mock('@/requests/playlists', () => ({ getPlaylist: vi.fn(async () => ({ tracks: [] })) }))
vi.mock('@/helpers/usePlayFrom', () => ({ playAlbumAt: vi.fn(), playPlaylistAt: vi.fn(), resumeIndex: () => 0 }))
vi.mock('@/helpers/continueDismiss', () => ({ removeFromContinue: vi.fn() }))

import ContinueCard from '@/components/HomeView/ContinueCard.vue'

const entry = {
    type: 'album',
    item: { albumhash: 'a0000000000000pr', title: 'Album', track_index: 1, track_total: 5, time: '20 min' },
    dismiss: { type: 'album', hash: 'a0000000000000pr' },
}

const stubs = { RouterLink: { props: ['to'], template: '<a><slot /></a>' } }

describe('ContinueCard: up next holds its space from the first frame (#776)', () => {
    it('renders the column with three slots before its tracks have arrived', () => {
        getAlbumTracks.mockReturnValue(new Promise(() => {}))

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })

        expect(w.find('.up-next').exists()).toBe(true)
        expect(w.findAll('.up-next > li').length - 1, 'three slots after the caption').toBe(3)
        expect(w.findAll('.next-slot-empty')).toHaveLength(3)
        expect(w.findAll('.next-row')).toHaveLength(0)
    })

    it('fills the same three slots when the tracks arrive, without adding any', async () => {
        const track = (n: number) => ({ trackhash: `t${n}`, title: `Track ${n}`, artists: [], duration: 200 })
        getAlbumTracks.mockResolvedValue([track(1), track(2), track(3), track(4), track(5)])

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()

        expect(w.findAll('.up-next > li').length - 1).toBe(3)
        expect(w.findAll('.next-row')).toHaveLength(3)
        expect(w.findAll('.next-slot-empty')).toHaveLength(0)
    })

    it('hides the column when the load answers with no tracks', async () => {
        getAlbumTracks.mockResolvedValue([])

        const w = mount(ContinueCard, { props: { entry }, global: { stubs } })
        await flushPromises()

        expect(w.find('.up-next').classes()).toContain('up-next-none')
    })
})
