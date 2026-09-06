import { beforeEach, describe, expect, it, vi } from 'vitest'

// useAxios is the single funnel every request runs through: it toggles the
// loader, pops the login modal on 401 (except while pairing), re-auths on a
// 422 signature failure and returns errors as values instead of throwing.
// Every caller in src/requests depends on that contract, and it had no tests.

const axiosMock = vi.fn()
vi.mock('axios', () => ({
    default: (...args: any[]) => axiosMock(...args),
}))

const showLoginModal = vi.fn()
vi.mock('@/stores/modal', () => ({
    default: () => ({ showLoginModal }),
}))

const startLoading = vi.fn()
const stopLoading = vi.fn()
vi.mock('@/stores/loader', () => ({
    default: () => ({ startLoading, stopLoading }),
}))

const logoutUser = vi.fn()
vi.mock('@/requests/auth', () => ({
    logoutUser: (...args: any[]) => logoutUser(...args),
}))

import useAxios from '@/requests/useAxios'

function axiosError(status: number | undefined, data: any = {}) {
    return Object.assign(new Error('Request failed'), {
        response: status === undefined ? undefined : { status, data },
    })
}

beforeEach(() => {
    axiosMock.mockReset()
    showLoginModal.mockClear()
    startLoading.mockClear()
    stopLoading.mockClear()
    logoutUser.mockClear()
    window.location.hash = ''
})

describe('useAxios', () => {
    it('returns data and status on success and cycles the loader', async () => {
        axiosMock.mockResolvedValue({ data: { ok: 1 }, status: 200 })

        const res = await useAxios({ url: '/x' })

        expect(res).toEqual({ data: { ok: 1 }, status: 200 })
        expect(startLoading).toHaveBeenCalledTimes(1)
        expect(stopLoading).toHaveBeenCalledTimes(1)
    })

    it('defaults to POST and passes props as the request body', async () => {
        axiosMock.mockResolvedValue({ data: {}, status: 200 })

        await useAxios({ url: '/x', props: { a: 1 } })

        const arg = axiosMock.mock.calls[0][0]
        expect(arg.method).toBe('POST')
        expect(arg.data).toEqual({ a: 1 })
    })

    it('returns the error as a value instead of throwing — callers branch on status', async () => {
        axiosMock.mockRejectedValue(axiosError(500, { error: 'boom' }))

        const res = await useAxios({ url: '/x' })

        expect(res.status).toBe(500)
        expect(res.data).toEqual({ error: 'boom' })
        expect(res.error).toBe('Request failed')
        // The loader must not stay stuck on a failed request.
        expect(stopLoading).toHaveBeenCalledTimes(1)
    })

    it('pops the login modal on 401', async () => {
        axiosMock.mockRejectedValue(axiosError(401))

        await useAxios({ url: '/x' })

        expect(showLoginModal).toHaveBeenCalledTimes(1)
        expect(logoutUser).not.toHaveBeenCalled()
    })

    it('does NOT pop the login modal on 401 while pairing', async () => {
        // The QR pairing route redeems its code before any session exists; the
        // boot requests it races answer 401, and a modal on top of the pairing
        // screen made scanning look broken.
        window.location.hash = '#/pair?code=abc'
        axiosMock.mockRejectedValue(axiosError(401))

        await useAxios({ url: '/x' })

        expect(showLoginModal).not.toHaveBeenCalled()
    })

    it('logs out and re-prompts on a 422 signature failure', async () => {
        // A nuked server config folder invalidates every issued JWT; the only
        // way back is a fresh login.
        axiosMock.mockRejectedValue(axiosError(422, { msg: 'Signature verification failed' }))

        await useAxios({ url: '/x' })

        expect(logoutUser).toHaveBeenCalledTimes(1)
        expect(showLoginModal).toHaveBeenCalledTimes(1)
    })

    it('treats an ordinary 422 as a plain error — no logout', async () => {
        axiosMock.mockRejectedValue(axiosError(422, { msg: 'validation error' }))

        const res = await useAxios({ url: '/x' })

        expect(logoutUser).not.toHaveBeenCalled()
        expect(showLoginModal).not.toHaveBeenCalled()
        expect(res.status).toBe(422)
    })

    it('survives a network error without a response object', async () => {
        axiosMock.mockRejectedValue(axiosError(undefined))

        const res = await useAxios({ url: '/x' })

        expect(res.status).toBeUndefined()
        expect(res.error).toBe('Request failed')
        expect(showLoginModal).not.toHaveBeenCalled()
        expect(stopLoading).toHaveBeenCalledTimes(1)
    })
})
