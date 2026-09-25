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

    // #144: one message for both halves — a second toast would replace the first.
    it.each([
        [undefined, 'Track tags updated'],
        [{ name: '03 - Game Lost.mp3' }, 'Tags updated, file renamed to 03 - Game Lost.mp3'],
        [{ name: '03 - Game Lost.mp3', unchanged: true }, 'Track tags updated'],
        [{ error: 'Another file already has that name' }, 'Tags updated — the file kept its name: Another file already has that name'],
        [{ name: '03 - X.mp3', warning: 'taken' }, 'Tags updated, file renamed to 03 - X.mp3 — the lyrics file kept the old name'],
    ])('reports the rename outcome %j in the one notification', async (rename, text) => {
        const { Notification } = await import('@/stores/notification')
        useAxiosMock.mockResolvedValue({ data: { track: { trackhash: 'H' }, rename }, status: 200 })

        await editTrackTags('H', { title: 'Game Lost', rename_file: true })

        expect((Notification as any).mock.calls.at(-1)[0]).toBe(text)
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
