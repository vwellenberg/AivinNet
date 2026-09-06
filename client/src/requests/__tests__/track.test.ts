import { beforeEach, describe, expect, it, vi } from 'vitest'

const useAxiosMock = vi.fn()

vi.mock('@/requests/useAxios', () => ({
    default: (...args: any[]) => useAxiosMock(...args),
}))

vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 0, Error: 1, Info: 2 },
    Notification: vi.fn(),
}))

import { editTrackTags } from '@/requests/track'

describe('editTrackTags', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
    })

    it('issues a PUT to /track/<hash>/tags with the payload and returns the track on 200', async () => {
        const track = { trackhash: 'NEWHASH', title: 'X' }
        useAxiosMock.mockResolvedValue({ data: { track }, status: 200 })

        const res = await editTrackTags('OLDHASH', { title: 'X', artists: ['A', 'B'] })

        expect(useAxiosMock).toHaveBeenCalledTimes(1)
        const arg = useAxiosMock.mock.calls[0][0]
        expect(arg.method).toBe('PUT')
        expect(arg.url).toContain('/track/OLDHASH/tags')
        expect(arg.props).toEqual({ title: 'X', artists: ['A', 'B'] })
        expect(res).toEqual(track)
    })

    it('returns null on 403 (non-admin)', async () => {
        useAxiosMock.mockResolvedValue({ data: { error: 'forbidden' }, status: 403 })
        expect(await editTrackTags('H', { title: 'X' })).toBeNull()
    })

    it('returns null on 404 (track not found)', async () => {
        useAxiosMock.mockResolvedValue({ data: {}, status: 404 })
        expect(await editTrackTags('H', { title: 'X' })).toBeNull()
    })

    it('returns null on a generic error status', async () => {
        useAxiosMock.mockResolvedValue({ data: { error: 'boom' }, status: 400 })
        expect(await editTrackTags('H', {})).toBeNull()
    })
})
