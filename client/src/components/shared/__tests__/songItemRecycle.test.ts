import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'

// Same light mount as songItemFav.test.ts: the queue store and the context
// menu helper drag in the router and every view, and neither matters here.
vi.mock('@/stores/queue', () => ({
    default: () => ({ currentindex: -1, currenttrackhash: '', playing: false }),
}))
vi.mock('@/helpers/contextMenuHandler', () => ({
    showTrackContextMenu: () => {},
}))
vi.mock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return { ...actual, useRoute: () => ({ path: '/playlist/1' }) }
})

import SongItem from '../SongItem.vue'

import { dropSources } from '@/enums'
import { Track } from '@/interfaces'

// ---------------------------------------------------------------------------
// The virtual scrollers now RECYCLE a row for the next track instead of
// rebuilding it (scrollerRecycling.test.ts). The same component instance then
// shows another track — and whatever it said about the previous one must not
// come along. With `:key` the remount reset this by accident; without it, a
// drag that auto-scrolled the list painted the lifted look on a stranger.
// ---------------------------------------------------------------------------

const track = (hash: string, index: number) =>
    ({
        trackhash: hash,
        title: `Track ${hash}`,
        album: 'An album',
        albumhash: 'alb',
        artists: [],
        albumartists: [],
        duration: 120,
        index,
    } as unknown as Track)

beforeEach(() => {
    setActivePinia(createPinia())
    const dragImg = document.createElement('div')
    dragImg.id = 'drag-img'
    document.body.appendChild(dragImg)
    vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
    document.body.innerHTML = ''
    vi.restoreAllMocks()
})

describe('a recycled song row', () => {
    it('drops the drag state of the track it showed before', async () => {
        const wrapper = mount(SongItem, {
            shallow: true,
            props: { track: track('a', 4), index: 5, source: dropSources.playlist, droppable: true },
        })

        await wrapper.trigger('dragstart')
        await wrapper.trigger('dragover', { clientY: 0 })
        expect(wrapper.classes()).toContain('is-dragging')

        // The scroller hands this row the next track.
        await wrapper.setProps({ track: track('z', 40), index: 41 })
        await nextTick()

        expect(wrapper.classes()).not.toContain('is-dragging')
        expect(wrapper.classes()).not.toContain('drag-over-top')
        expect(wrapper.classes()).not.toContain('drag-over-bottom')
    })

    it('keeps its state while it keeps showing the same track', async () => {
        const wrapper = mount(SongItem, {
            shallow: true,
            props: { track: track('a', 4), index: 5, source: dropSources.playlist, droppable: true },
        })

        await wrapper.trigger('dragstart')
        // A recompute of the list hands over a new object for the same track.
        await wrapper.setProps({ track: track('a', 4) })
        await nextTick()

        expect(wrapper.classes()).toContain('is-dragging')
    })
})
