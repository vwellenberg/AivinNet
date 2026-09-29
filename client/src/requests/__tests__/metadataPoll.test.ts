import { beforeEach, describe, expect, it, vi } from 'vitest'

// A long apply keeps rewriting files on the server. One failed poll used to
// end the wait ("The write was lost") and unlock the dialog mid-write.

const useAxiosMock = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => useAxiosMock(...args) }))

import { pollJob } from '@/requests/metadata'

const answer = (status: number, data: unknown = undefined) => ({ status, data })

describe('pollJob', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
    })

    it('rides out a few failed polls while the job keeps running', async () => {
        useAxiosMock
            .mockResolvedValueOnce(answer(0))
            .mockResolvedValueOnce(answer(503))
            .mockResolvedValueOnce(answer(200, { state: 'done', result: 42 }))

        expect(await pollJob<number>('job1', { what: 'write' })).toEqual({ result: 42, error: null })
    })

    it('treats only an explicit 404 as a lost job', async () => {
        useAxiosMock.mockResolvedValueOnce(answer(404, { error: 'Unknown job' }))

        expect(await pollJob('job1', { what: 'write' })).toEqual({ result: null, error: 'Unknown job' })
        expect(useAxiosMock).toHaveBeenCalledTimes(1)
    })

    it('gives up after several failures in a row', async () => {
        useAxiosMock.mockResolvedValue(answer(0))

        const res = await pollJob('job1', { what: 'write' })

        expect(res.result).toBeNull()
        expect(res.error).toBe('Lost contact with the write')
        expect(useAxiosMock).toHaveBeenCalledTimes(5)
    })
})
