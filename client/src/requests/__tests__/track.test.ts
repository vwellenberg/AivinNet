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

    /** The server writes in a job (#376): the PUT answers with its id, the poll with the outcome. */
    const asJob = (result: unknown, state = 'done', error: string | null = null) => {
        useAxiosMock
            .mockResolvedValueOnce({ data: { job: 'j1' }, status: 200 })
            .mockResolvedValueOnce({ data: { state, result, error }, status: 200 })
    }

    it('issues a PUT to /track/<hash>/tags, polls the job and returns the re-indexed track', async () => {
        const track = { trackhash: 'NEWHASH', title: 'X' }
        asJob({ track })

        const res = await editTrackTags('OLDHASH', { title: 'X', artists: ['A', 'B'] })

        expect(useAxiosMock).toHaveBeenCalledTimes(2)
        const arg = useAxiosMock.mock.calls[0][0]
        expect(arg.method).toBe('PUT')
        expect(arg.url).toContain('/track/OLDHASH/tags')
        expect(arg.props).toEqual({ title: 'X', artists: ['A', 'B'] })
        expect(useAxiosMock.mock.calls[1][0]).toMatchObject({ url: '/metadata/job/j1', method: 'GET' })
        expect(res).toEqual(track)
    })

    it('keeps polling while the write runs', async () => {
        vi.useFakeTimers()
        useAxiosMock
            .mockResolvedValueOnce({ data: { job: 'j1' }, status: 200 })
            .mockResolvedValueOnce({ data: { state: 'running', result: null, error: null }, status: 200 })
            .mockResolvedValueOnce({ data: { state: 'done', result: { track: { trackhash: 'N' } }, error: null }, status: 200 })

        const pending = editTrackTags('H', { title: 'X' })
        await vi.runAllTimersAsync()

        expect(await pending).toEqual({ trackhash: 'N' })
        expect(useAxiosMock).toHaveBeenCalledTimes(3)
        vi.useRealTimers()
    })

    it('a write that failed in the job says why and returns null', async () => {
        const { Notification } = await import('@/stores/notification')
        asJob(null, 'error', 'file is read-only')

        expect(await editTrackTags('H', { title: 'X' })).toBeNull()
        expect((Notification as any).mock.calls.at(-1)[0]).toBe('file is read-only')
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
        asJob({ track: { trackhash: 'H' }, rename })

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
