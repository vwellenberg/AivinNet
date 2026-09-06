import { beforeEach, describe, expect, it } from 'vitest'
import { getRecentPlaylistIds, recordRecentPlaylist } from '../recentPlaylists'

describe('recentPlaylists', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('returns an empty list when nothing is stored', () => {
        expect(getRecentPlaylistIds()).toEqual([])
    })

    it('records newest playlist first', () => {
        recordRecentPlaylist(1)
        recordRecentPlaylist(2)
        expect(getRecentPlaylistIds()).toEqual([2, 1])
    })

    it('dedupes and moves a re-used playlist back to the front', () => {
        recordRecentPlaylist(1)
        recordRecentPlaylist(2)
        recordRecentPlaylist(1)
        expect(getRecentPlaylistIds()).toEqual([1, 2])
    })

    it('caps the stored history length', () => {
        for (let id = 1; id <= 15; id++) {
            recordRecentPlaylist(id)
        }
        const ids = getRecentPlaylistIds()
        expect(ids).toHaveLength(10)
        expect(ids[0]).toBe(15)
        expect(ids).not.toContain(5)
    })

    it('persists across reads (localStorage backed)', () => {
        recordRecentPlaylist(42)
        expect(getRecentPlaylistIds()).toEqual([42])
    })
})
