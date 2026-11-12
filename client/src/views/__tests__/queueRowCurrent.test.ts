import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The playing track sits at queue position 1 — and the same track is queued
// again at position 5.
vi.mock('@/stores/queue', () => ({
    default: () => ({ currentindex: 1, currenttrackhash: 'ladders', playing: true }),
}))
vi.mock('@/helpers/contextMenuHandler', () => ({
    showTrackContextMenu: () => {},
}))
vi.mock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return { ...actual, useRoute: () => ({ path: '/nowplaying/home' }) }
})

import SongItem from '@/components/shared/SongItem.vue'
import { Track } from '@/interfaces'
import { queueRowProps } from '@/views/NowPlaying/queueRow'

// ---------------------------------------------------------------------------
// A queue can hold the same track twice. The Now Playing list then highlighted
// BOTH rows: the view passed `isQueueTrack`, the row's prop is `is_queue_track`,
// and without it the row compares trackhashes instead of positions.
// ---------------------------------------------------------------------------

const track = (hash: string) =>
    ({
        trackhash: hash,
        title: `Track ${hash}`,
        album: 'An album',
        albumhash: 'alb',
        artists: [],
        albumartists: [],
        duration: 120,
    }) as unknown as Track

const QUEUE = ['once', 'ladders', 'perfecto', 'selfcare', 'wings', 'ladders', 'small']

function currentRows() {
    return QUEUE.map((hash, index) =>
        mount(SongItem, { shallow: true, props: queueRowProps(track(hash), index, QUEUE.length) })
            .classes()
            .includes('current')
    )
}

beforeEach(() => setActivePinia(createPinia()))
afterEach(() => vi.restoreAllMocks())

describe('the Now Playing queue', () => {
    it('highlights the playing position only, not every copy of the track', () => {
        expect(currentRows()).toEqual([false, true, false, false, false, false, false])
    })
})
