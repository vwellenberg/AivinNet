import { beforeEach, describe, expect, it, vi } from 'vitest'

// The single-track edit writes in a job (#376): the PUT answers with a job id,
// the track comes from polling `/metadata/job/<id>`.

const { calls, replies, notes } = vi.hoisted(() => ({
    calls: [] as any[],
    replies: [] as any[],
    notes: [] as [string, string][],
}))

vi.mock('@/requests/useAxios', () => ({
    default: vi.fn(async (args: any) => {
        calls.push(args)
        return replies.shift() ?? { status: 500, data: {} }
    }),
}))
vi.mock('@/stores/notification', () => ({
    NotifType: { Success: 'success', Info: 'info', Error: 'error' },
    Notification: class {
        constructor(text: string, type: string) {
            notes.push([text, type])
        }
    },
}))

import { editTrackTags } from '@/requests/track'

describe('editTrackTags', () => {
    beforeEach(() => {
        vi.useFakeTimers()
        calls.length = 0
        replies.length = 0
        notes.length = 0
    })

    it('polls the job and returns the re-indexed track', async () => {
        replies.push(
            { status: 200, data: { job: 'j1' } },
            { status: 200, data: { state: 'running', result: null, error: null } },
            { status: 200, data: { state: 'done', result: { track: { trackhash: 'new' } }, error: null } }
        )

        const pending = editTrackTags('old', { title: 'New', filepath: '/m/a.wav' })
        await vi.runAllTimersAsync()

        expect(await pending).toEqual({ trackhash: 'new' })
        expect(calls[0]).toMatchObject({ method: 'PUT', props: { title: 'New', filepath: '/m/a.wav' } })
        expect(calls.slice(1).map(c => c.url)).toEqual(['/metadata/job/j1', '/metadata/job/j1'])
        expect(notes).toEqual([['Track tags updated', 'success']])
    })

    it('a failed write says why and returns null', async () => {
        replies.push(
            { status: 200, data: { job: 'j2' } },
            { status: 200, data: { state: 'error', result: null, error: 'file is read-only' } }
        )

        const pending = editTrackTags('old', { title: 'New' })
        await vi.runAllTimersAsync()

        expect(await pending).toBeNull()
        expect(notes).toEqual([['file is read-only', 'error']])
    })

    it('a refusal the server answers at once is shown without polling', async () => {
        replies.push({ status: 409, data: { error: 'A scan is running, try again', busy: true } })

        expect(await editTrackTags('old', { title: 'New' })).toBeNull()
        expect(calls).toHaveLength(1)
        expect(notes).toEqual([['A scan is running, try again', 'error']])
    })
})
