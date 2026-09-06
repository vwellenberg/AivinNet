import { beforeEach, describe, expect, it, vi } from 'vitest'

const useAxiosMock = vi.fn()

vi.mock('@/requests/useAxios', () => ({
    default: (...args: any[]) => useAxiosMock(...args),
}))

vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    Notification: vi.fn(),
    useToast: () => ({ showNotification: vi.fn() }),
}))

vi.mock('@/stores/pages/folder', () => ({ default: () => ({}) }))
vi.mock('@/utils/recentPlaylists', () => ({ recordRecentPlaylist: vi.fn() }))

import { movePlaylistTrack } from '@/requests/playlists'

describe('movePlaylistTrack', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
    })

    it('issues a PUT to /playlists/<pid>/move-track with both anchors', async () => {
        useAxiosMock.mockResolvedValue({ data: { msg: 'Done' }, status: 200 })

        const ok = await movePlaylistTrack(7, 'MOVED', 'ANCHOR')

        expect(useAxiosMock).toHaveBeenCalledTimes(1)
        const arg = useAxiosMock.mock.calls[0][0]
        expect(arg.method).toBe('PUT')
        expect(arg.url).toContain('/7/move-track')
        expect(arg.props).toEqual({ trackhash: 'MOVED', before_trackhash: 'ANCHOR' })
        expect(ok).toBe(true)
    })

    it('sends before_trackhash: null when the track moves to the end', async () => {
        useAxiosMock.mockResolvedValue({ data: { msg: 'Done' }, status: 200 })

        await movePlaylistTrack(7, 'MOVED', null)

        expect(useAxiosMock.mock.calls[0][0].props).toEqual({ trackhash: 'MOVED', before_trackhash: null })
    })

    it('never sends a trackhash list — that is what truncated playlists', async () => {
        // Regression guard: the old reorderTracks() sent
        // { trackhashes: [...only the paginated-in tracks] } and the endpoint
        // replaced the stored list with it (120 tracks -> 44 after one drag).
        useAxiosMock.mockResolvedValue({ data: { msg: 'Done' }, status: 200 })

        await movePlaylistTrack(7, 'MOVED', 'ANCHOR')

        const props = useAxiosMock.mock.calls[0][0].props
        expect(props).not.toHaveProperty('trackhashes')
        expect(Object.values(props).some(Array.isArray)).toBe(false)
        expect(useAxiosMock.mock.calls[0][0].url).not.toContain('/reorder')
    })

    it('reports failure to the caller so the optimistic move can be rolled back', async () => {
        useAxiosMock.mockResolvedValue({ data: { error: 'nope' }, status: 400 })
        expect(await movePlaylistTrack(7, 'MOVED', 'ANCHOR')).toBe(false)
    })

    it('reports failure on a rejected reorder-style conflict too', async () => {
        useAxiosMock.mockResolvedValue({ data: { error: 'conflict' }, status: 409 })
        expect(await movePlaylistTrack(7, 'MOVED', null)).toBe(false)
    })
})
