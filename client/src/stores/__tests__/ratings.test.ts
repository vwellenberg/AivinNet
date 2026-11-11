import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Personal track ratings (#777): the session's answer per trackhash, and the
// optimistic change that rolls back when the server refuses it.
const { setTrackRating, clearTrackRating, getAllTrackRatings } = vi.hoisted(() => ({
    setTrackRating: vi.fn(),
    clearTrackRating: vi.fn(),
    getAllTrackRatings: vi.fn(),
}))

vi.mock('@/requests/rating', () => ({ setTrackRating, clearTrackRating, getAllTrackRatings }))

import useRatings, { __resetRatingsTestState } from '../ratings'

const HASH = '1234567890abcdef'

describe('ratings store', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        setTrackRating.mockReset()
        clearTrackRating.mockReset()
        getAllTrackRatings.mockReset()
        __resetRatingsTestState()
    })

    it('falls back to the rating the copy was loaded with', () => {
        const store = useRatings()

        expect(store.rating(HASH, 3)).toBe(3)
        expect(store.rating(HASH)).toBeNull()
    })

    it('answers the session change in preference to the loaded copy', () => {
        const store = useRatings()
        store.record(HASH, 5)

        expect(store.rating(HASH, 2)).toBe(5)
    })

    it('a recorded clear reads as unrated, not as the fallback', () => {
        const store = useRatings()
        store.record(HASH, null)

        expect(store.rating(HASH, 4)).toBeNull()
    })

    it('sets the rating optimistically and keeps it when the server agrees', async () => {
        setTrackRating.mockResolvedValue(true)
        const store = useRatings()

        const ok = await store.rate(HASH, 4, null)

        expect(ok).toBe(true)
        expect(setTrackRating).toHaveBeenCalledWith(HASH, 4)
        expect(store.rating(HASH)).toBe(4)
    })

    it('rolls back to the previous answer when the server refuses a set', async () => {
        setTrackRating.mockResolvedValue(false)
        const store = useRatings()
        store.record(HASH, 2)

        const ok = await store.rate(HASH, 5, null)

        expect(ok).toBe(false)
        expect(store.rating(HASH)).toBe(2)
    })

    it('rolls back to the loaded copy value when the server refuses and nothing was recorded', async () => {
        setTrackRating.mockResolvedValue(false)
        const store = useRatings()

        await store.rate(HASH, 5, 3)

        expect(store.rating(HASH)).toBe(3)
    })

    it('a clear goes to the clear request, and rolls back when refused', async () => {
        clearTrackRating.mockResolvedValue(false)
        const store = useRatings()
        store.record(HASH, 1)

        const ok = await store.rate(HASH, null, null)

        expect(clearTrackRating).toHaveBeenCalledWith(HASH)
        expect(setTrackRating).not.toHaveBeenCalled()
        expect(ok).toBe(false)
        expect(store.rating(HASH)).toBe(1)
    })

    it('a successful clear reads as unrated afterwards', async () => {
        clearTrackRating.mockResolvedValue(true)
        const store = useRatings()
        store.record(HASH, 1)

        await store.rate(HASH, null, 1)

        expect(store.rating(HASH, 1)).toBeNull()
    })

    it('an older refusal does not roll back a newer change to the same track', async () => {
        // 4 goes out, then 5; the server refuses the 4 only after the 5 was recorded.
        let refuseFour!: (ok: boolean) => void
        setTrackRating
            .mockReturnValueOnce(new Promise<boolean>(resolve => (refuseFour = resolve)))
            .mockResolvedValueOnce(true)
        const store = useRatings()

        const four = store.rate(HASH, 4, null)
        await store.rate(HASH, 5, null)
        refuseFour(false)
        await four

        expect(store.rating(HASH)).toBe(5)
    })

    it('the newest refusal still rolls back', async () => {
        setTrackRating.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
        const store = useRatings()

        await store.rate(HASH, 4, null)
        await store.rate(HASH, 5, null)

        expect(store.rating(HASH)).toBe(4)
    })

    it('seeds the user\'s ratings over stale loaded copies, but not over a change made here', async () => {
        const OTHER = 'fedcba0987654321'
        getAllTrackRatings.mockResolvedValue({ [HASH]: 2, [OTHER]: 5 })
        const store = useRatings()
        store.record(HASH, 4) // rated in this session before the seed came back

        await store.seed()

        expect(store.rating(HASH, null)).toBe(4)
        expect(store.rating(OTHER, null)).toBe(5) // a restored queue copy without a rating
    })
})
