import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #144, part 2: the single-track editor offers to rename the file — but only
// when the name would actually change. The pattern is built from the title and
// the track number, so an artist or album edit has nothing to rename, and a
// box that appears anyway would rename files nobody meant to touch.
// ---------------------------------------------------------------------------

const { editTrackTags } = vi.hoisted(() => ({ editTrackTags: vi.fn(() => Promise.resolve(null)) }))
vi.mock('@/requests/track', () => ({ editTrackTags }))
vi.mock('@/stores/notification', () => ({ Notification: vi.fn(), NotifType: {} }))
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ retagTrack: vi.fn() }) }))

import EditTrack from '@/components/modals/EditTrack.vue'

const track = () =>
    ({
        trackhash: 'H',
        title: 'Game Lost',
        album: 'The Guild 2',
        artists: [{ name: 'Unknown' }],
        albumartists: [{ name: 'Unknown' }],
        track: 3,
        filepath: '/m/The Guild 2/03. Game Lost.mp3',
    } as any)

const sent = () => (editTrackTags.mock.calls.at(-1) as any)[1]

describe('the track editor renames the file (#144)', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        vi.clearAllMocks()
    })

    it('offers nothing while title and number are unchanged', async () => {
        const w = mount(EditTrack, { props: { track: track() } })
        await w.find('#et-album').setValue('Die Gilde 2')

        expect(w.find('.et-rename').exists()).toBe(false)
        await w.find('form').trigger('submit')
        await flushPromises()
        expect(sent()).toEqual({ album: 'Die Gilde 2' })
    })

    it('offers the rename once the title changes, ticked, showing the current name', async () => {
        const w = mount(EditTrack, { props: { track: track() } })
        await w.find('#et-title').setValue('Game Lost (Reprise)')

        const box = w.find('.et-rename')
        expect(box.exists()).toBe(true)
        expect(box.text()).toContain('03. Game Lost.mp3')
        expect(box.text()).toContain('named after the new number and title')

        await w.find('form').trigger('submit')
        await flushPromises()
        expect(sent()).toEqual({ title: 'Game Lost (Reprise)', rename_file: true })
    })

    it('offers it for a new track number too, and leaves the file alone when unticked', async () => {
        const w = mount(EditTrack, { props: { track: track() } })
        await w.find('#et-track').setValue(7)
        expect(w.find('.et-rename').exists()).toBe(true)

        await w.find('.et-rename input').setValue(false)
        await w.find('form').trigger('submit')
        await flushPromises()
        expect(sent()).toEqual({ track: 7 })
    })
})
