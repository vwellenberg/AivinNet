import { beforeEach, describe, expect, it, vi } from 'vitest'

// The logo's find (#828): a failed request must not read as "nothing found" —
// useAxios answers a failure with `error` instead of throwing.
const { useAxios } = vi.hoisted(() => ({ useAxios: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: useAxios }))

import { getSignalFind } from '@/requests/home'

describe('getSignalFind', () => {
    beforeEach(() => useAxios.mockReset())

    it('returns the find, and asks to skip the one on the plate', async () => {
        const find = { type: 'album', reason: 'Never played', item: { albumhash: 'a1' } }
        useAxios.mockResolvedValue({ data: { find }, status: 200 })

        expect(await getSignalFind('a1b2')).toEqual(find)
        expect(useAxios.mock.calls[0][0].url).toMatch(/\/nothome\/signal\?skip=a1b2$/)
    })

    it('null is "nothing to find"', async () => {
        useAxios.mockResolvedValue({ data: { find: null }, status: 200 })
        expect(await getSignalFind()).toBeNull()
    })

    it('a failure throws instead of passing as "nothing to find"', async () => {
        useAxios.mockResolvedValue({ error: 'Network Error', data: undefined, status: undefined })
        await expect(getSignalFind()).rejects.toThrow('Network Error')
    })
})
