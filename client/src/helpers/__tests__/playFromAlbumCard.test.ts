import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// "Surprise me" knows only the album's hash. With an empty name the queue's
// source showed as a blank "Album" plate, and "Add queue to playlist"
// pre-filled an empty name.

vi.mock('@/requests/album', () => ({
    getAlbumTracks: vi.fn(async () => [
        { trackhash: 't1', album: 'Kind of Blue', albumhash: 'al1' },
        { trackhash: 't2', album: 'Kind of Blue', albumhash: 'al1' },
        { trackhash: 't3', album: 'Kind of Blue', albumhash: 'al1' },
    ]),
}))

const setFromAlbum = vi.fn()
vi.mock('@/stores/queue/tracklist', () => ({ default: () => ({ setFromAlbum }) }))
vi.mock('@/stores/queue', () => ({ default: () => ({ playSource: vi.fn() }) }))

const dropCard = vi.fn(() => () => {})
vi.mock('@/stores/home', () => ({ default: () => ({ dropCard }) }))

import { getAlbumTracks } from '@/requests/album'
import { playFromAlbumCard } from '@/helpers/usePlayFrom'

describe('playFromAlbumCard', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        setFromAlbum.mockReset()
        dropCard.mockClear()
    })

    it('names the source after the album when the caller has no name', async () => {
        await playFromAlbumCard('al1', '')

        expect(setFromAlbum.mock.calls[0][0]).toBe('Kind of Blue')
    })

    it('keeps the name the caller gives', async () => {
        await playFromAlbumCard('al1', 'Given')

        expect(setFromAlbum.mock.calls[0][0]).toBe('Given')
    })

    // "Almost complete" (#529): the card's play button started the album
    // from the top instead of the songs still to go.
    it('plays only the songs to go when the card names them', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue', ['t3', 't1'])

        // In album order, not in the order given.
        expect(setFromAlbum.mock.calls[0][2].map((t: { trackhash: string }) => t.trackhash)).toEqual(['t1', 't3'])
    })

    it('plays the whole album without a rest, or when none of it is left', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue')
        await playFromAlbumCard('al1', 'Kind of Blue', ['gone'])

        for (const call of setFromAlbum.mock.calls) expect(call[2]).toHaveLength(3)
    })

    // Pressing the card's play button takes the card out of "Almost complete"
    // at once, not when the play is logged (#529 follow-up).
    it('takes its Almost-complete card out of the row when its rest plays', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue', ['t3', 't1'])

        expect(dropCard).toHaveBeenCalledTimes(1)
        expect(dropCard).toHaveBeenCalledWith('almost_complete', 'al1')
    })

    it('keeps the card when played without a rest (plain album card)', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue')

        expect(dropCard).not.toHaveBeenCalled()
    })

    it('keeps the card when none of its rest is on the album (the whole album plays)', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue', ['gone'])

        expect(setFromAlbum.mock.calls[0][2]).toHaveLength(3)
        expect(dropCard).not.toHaveBeenCalled()
    })

    // A song of the rest the album no longer holds never plays: dropping the
    // card would hide it on every press and bring it back on every visit.
    it('keeps the card when part of its rest is not on the album', async () => {
        await playFromAlbumCard('al1', 'Kind of Blue', ['t3', 'gone'])

        expect(setFromAlbum.mock.calls[0][2].map((t: { trackhash: string }) => t.trackhash)).toEqual(['t3'])
        expect(dropCard).not.toHaveBeenCalled()
    })

    it('keeps the card when the album tracks are not found', async () => {
        vi.mocked(getAlbumTracks).mockResolvedValueOnce([])

        await playFromAlbumCard('al1', 'Kind of Blue', ['t1'])

        expect(setFromAlbum).not.toHaveBeenCalled()
        expect(dropCard).not.toHaveBeenCalled()
    })
})
