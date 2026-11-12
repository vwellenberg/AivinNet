import { beforeEach, describe, expect, it, vi } from 'vitest'

// The ratings import from the files (#789): start the job, then poll its own
// admin-only status route through the shared pollJob.

const useAxiosMock = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => useAxiosMock(...args) }))
vi.mock('@/stores/notification', () => ({ useToast: () => ({ showNotification: vi.fn() }) }))

import { importRatingsFromFiles } from '@/requests/rating'

const answer = (status: number, data: unknown = undefined) => ({ status, data })

describe('importRatingsFromFiles', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
    })

    it('starts the job and returns the report once it is done', async () => {
        const report = { imported: 3, skipped: 10, unreadable: 1 }
        useAxiosMock
            .mockResolvedValueOnce(answer(200, { job: 'job7' }))
            .mockResolvedValueOnce(answer(200, { state: 'done', result: report }))

        expect(await importRatingsFromFiles()).toEqual({ report, error: null })
        // Polled on the import's own status route, not /metadata/job.
        expect(useAxiosMock.mock.calls[1][0].url).toMatch(/\/ratings\/import-from-files\/job\/job7$/)
    })

    it('rides out a failed poll instead of giving up on the first', async () => {
        const report = { imported: 1, skipped: 0, unreadable: 0 }
        useAxiosMock
            .mockResolvedValueOnce(answer(200, { job: 'job7' }))
            .mockResolvedValueOnce(answer(0))
            .mockResolvedValueOnce(answer(200, { state: 'done', result: report }))

        expect(await importRatingsFromFiles()).toEqual({ report, error: null })
    })

    it('says an import is already running on 409, without polling', async () => {
        useAxiosMock.mockResolvedValueOnce(answer(409, {}))

        expect(await importRatingsFromFiles()).toEqual({ report: null, error: 'An import is already running' })
        expect(useAxiosMock).toHaveBeenCalledTimes(1)
    })

    it('passes a failed job on as its error', async () => {
        useAxiosMock
            .mockResolvedValueOnce(answer(200, { job: 'job7' }))
            .mockResolvedValueOnce(answer(200, { state: 'error', error: 'disk gone' }))

        expect(await importRatingsFromFiles()).toEqual({ report: null, error: 'disk gone' })
    })
})
