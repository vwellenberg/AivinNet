import { beforeEach, describe, expect, it, vi } from 'vitest'

const useAxiosMock = vi.fn()

vi.mock('@/requests/useAxios', () => ({
    default: (...args: any[]) => useAxiosMock(...args),
}))

import { checkExists } from '@/requests/lyrics'

// App.vue calls this on mount with `queue.currenttrack`, which is `{}` when
// nothing is queued. Both arguments were then undefined, the JSON body `{}`,
// and the server answered 422 on every start of the app.
describe('checkExists', () => {
    beforeEach(() => {
        useAxiosMock.mockReset()
        useAxiosMock.mockResolvedValue({ data: { exists: true }, status: 200 })
    })

    it.each([
        [undefined, undefined],
        ['', 'abc'],
        ['/music/a.flac', ''],
    ])('asks nothing without a track (filepath=%s, trackhash=%s)', async (filepath, trackhash) => {
        const res = await checkExists(filepath as any, trackhash as any)

        expect(useAxiosMock).not.toHaveBeenCalled()
        expect(res).toEqual({ exists: false })
    })

    it('asks the server for a real track', async () => {
        const res = await checkExists('/music/a.flac', 'abc')

        expect(useAxiosMock).toHaveBeenCalledTimes(1)
        expect(useAxiosMock.mock.calls[0][0].props).toEqual({ filepath: '/music/a.flac', trackhash: 'abc' })
        expect(res).toEqual({ exists: true })
    })
})
