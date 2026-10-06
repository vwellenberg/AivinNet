import { beforeEach, describe, expect, it, vi } from 'vitest'

// The cover search runs as a job on the server (AivinNet#295): the request
// answers with an id at once and the client polls. Searching inside the request
// held the server's one request thread, and everyone's playback with it.

const useAxiosMock = vi.fn()
vi.mock('@/requests/useAxios', () => ({ default: (...args: unknown[]) => useAxiosMock(...args) }))

import { fetchCoverFromMusicBrainz } from '@/requests/musicbrainz'

const answer = (status: number, data: unknown = undefined) => ({ status, data })

describe('fetchCoverFromMusicBrainz', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
    })

    it('starts the job and returns what it found', async () => {
        useAxiosMock
            .mockResolvedValueOnce(answer(200, { job: 'j1' }))
            .mockResolvedValueOnce(answer(200, { state: 'running' }))
            .mockResolvedValueOnce(answer(200, { state: 'done', result: { success: true, image: 'alb1.webp' } }))

        const res = await fetchCoverFromMusicBrainz('alb1')

        expect(res).toMatchObject({ success: true, image: 'alb1.webp', error: null })
        expect(useAxiosMock.mock.calls[1][0]).toMatchObject({ url: '/metadata/job/j1', method: 'GET' })
    })

    it('passes on "nothing found" from the job', async () => {
        useAxiosMock
            .mockResolvedValueOnce(answer(200, { job: 'j1' }))
            .mockResolvedValueOnce(answer(200, { state: 'done', result: { success: false, error: 'No cover found online' } }))

        expect(await fetchCoverFromMusicBrainz('alb1')).toMatchObject({
            success: false,
            image: null,
            error: 'No cover found online',
        })
    })

    it('reports a refused start without polling', async () => {
        useAxiosMock.mockResolvedValueOnce(answer(404, { error: 'Album not found' }))

        expect(await fetchCoverFromMusicBrainz('alb1')).toMatchObject({ success: false, error: 'Album not found' })
        expect(useAxiosMock).toHaveBeenCalledTimes(1)
    })
})
