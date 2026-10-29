import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The records of the whole history (#540), as GET /logger/records sends them.
const { getRecords } = vi.hoisted(() => ({ getRecords: vi.fn() }))
vi.mock('@/requests/stats', () => ({ getRecords }))

import RecordsBoard from '@/components/Stats/RecordsBoard.vue'

const BLUE = { title: 'Blue', artists: [{ name: 'The Artist' }] }

const RECORDS = {
    plays: 1_234,
    longest_session: { start: 1_790_000_000, end: 1_790_011_520, seconds: 11_520, plays: 41 },
    obsession: { track: BLUE, day: '2026-03-04', plays: 17 },
    milestones: [
        { number: 1, timestamp: 1_700_000_000, track: BLUE },
        { number: 1_000, timestamp: 1_790_000_000, track: null },
    ],
}

const board = async () => {
    const w = mount(RecordsBoard)
    await flushPromises()
    return w
}

beforeEach(() => {
    getRecords.mockReset().mockResolvedValue({ status: 200, data: RECORDS })
})

describe('RecordsBoard', () => {
    it('shows the longest session, the obsession and the milestone plays', async () => {
        const w = await board()

        expect(getRecords).toHaveBeenCalledTimes(1)
        const text = w.text()
        expect(text).toContain('Longest session')
        expect(text).toContain('3 h 12 min')
        expect(text).toContain('17 plays in a day')
        expect(text).toContain('Blue · The Artist · ')
        expect(text).toContain('Wednesday, March 4')
        expect(text).toContain('Your very first play')
        expect(text).toContain('Play #1,000')
    })

    it('names a track that has left the library as such', async () => {
        const w = await board()

        expect(w.text()).toContain('No longer in your library')
    })

    it('says so when nothing has been played yet', async () => {
        getRecords.mockResolvedValue({
            status: 200,
            data: { plays: 0, longest_session: null, obsession: null, milestones: [] },
        })

        const w = await board()

        expect(w.text()).toContain('Nothing played yet.')
        expect(w.findAll('.record')).toHaveLength(0)
    })

    it('shows a note when the records cannot be loaded', async () => {
        getRecords.mockResolvedValue({ status: 500, data: null })

        const w = await board()

        expect(w.text()).toContain('The records could not be loaded.')
        expect(w.findAll('.record')).toHaveLength(0)
    })
})
