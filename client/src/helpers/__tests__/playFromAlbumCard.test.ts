import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Surprise me" knows only the album's hash. With an empty name the queue's
// source showed as a blank "Album" plate, and "Add queue to playlist"
// pre-filled an empty name.

vi.mock('@/requests/album', () => ({
    getAlbumTracks: vi.fn(async () => [{ trackhash: 't1', album: 'Kind of Blue', albumhash: 'al1' }]),
}))

const setFromAlbum = vi.fn()
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ setFromAlbum }) }))
vi.mock('@/stores/queue', () => ({ default: () => ({ playSource: vi.fn() }) }))

import { playFromAlbumCard } from '@/helpers/usePlayFrom'

describe('playFromAlbumCard', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        setFromAlbum.mockReset()
    })

    it('names the source after the album when the caller has no name', async () => {
        await playFromAlbumCard('al1', '')

        expect(setFromAlbum.mock.calls[0][0]).toBe('Kind of Blue')
    })

    it('keeps the name the caller gives', async () => {
        await playFromAlbumCard('al1', 'Given')

        expect(setFromAlbum.mock.calls[0][0]).toBe('Given')
    })
})
