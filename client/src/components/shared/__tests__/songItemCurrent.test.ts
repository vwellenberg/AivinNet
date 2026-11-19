import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The "now playing" marker of a track row. Same light mount as
// songItemFav.test.ts; the queue store is a plain object the test fills in.
const queue = vi.hoisted(() => ({
    currentindex: -1,
    currenttrackhash: '',
    currenttrack: undefined as unknown,
    playing: true,
}))
vi.mock('@/stores/queue', () => ({ default: () => queue }))
vi.mock('@/helpers/contextMenuHandler', () => ({
    showTrackContextMenu: () => {},
}))
vi.mock('vue-router', async () => {
    const actual = await vi.importActual<typeof import('vue-router')>('vue-router')
    return { ...actual, useRoute: () => ({ path: '/folder' }) }
})

import SongItem from '../SongItem.vue'

import { dropSources } from '@/enums'
import { Track } from '@/interfaces'

// Title "2", same album, same artist → one trackhash for four different songs.
const HASH = 'f3a91c0d2e'
const row = (filepath: string, duration: number) =>
    ({
        trackhash: HASH,
        title: '2',
        album: 'Patrician III - Empire of the Seas Original Game Soundtrack',
        albumhash: 'alb',
        artists: [{ name: 'Region Music', artisthash: 'rm' }],
        albumartists: [],
        filepath,
        duration,
    } as unknown as Track)

const mountRow = (track: Track) =>
    mount(SongItem, {
        shallow: true,
        props: { track, index: 6, source: dropSources.folder },
    })

beforeEach(() => {
    setActivePinia(createPinia())
    const playing = row('/music/patrician/2a.ogg', 158)
    queue.currenttrack = playing
    queue.currenttrackhash = HASH
})

describe('the now-playing marker', () => {
    it('marks the row of the playing file', () => {
        expect(mountRow(row('/music/patrician/2a.ogg', 158)).classes()).toContain('current')
    })

    it('does not mark other songs that only share its trackhash', () => {
        for (const [path, s] of [
            ['/music/patrician/2b.ogg', 70],
            ['/music/patrician/2c.ogg', 113],
            ['/music/patrician/2d.ogg', 133],
        ] as const) {
            expect(mountRow(row(path, s)).classes()).not.toContain('current')
        }
    })

    it('still marks a duplicate file of the playing song', () => {
        expect(mountRow(row('/music/patrician/2a.flac', 159)).classes()).toContain('current')
    })
})
