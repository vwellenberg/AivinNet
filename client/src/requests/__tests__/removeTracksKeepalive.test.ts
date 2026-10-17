import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// #299: the edit mode sends a removal while the page goes away (tab closed,
// phone locked). axios sends over XHR, which the browser cancels with the
// document, so that one removal goes out on a `keepalive` fetch instead. The
// contract test checks the axios path against the server; this pins the fetch
// path to it: same URL, same body, only the transport differs.
// ---------------------------------------------------------------------------

const { useAxios, Notification } = vi.hoisted(() => ({ useAxios: vi.fn(), Notification: vi.fn() }))
vi.mock('@/requests/useAxios', () => ({ default: useAxios }))
vi.mock('@/stores/notification', () => ({ Notification, NotifType: { Error: 'error' }, useToast: vi.fn() }))

import { getBaseUrl } from '@/config'
import { removeTracks } from '@/requests/playlists'

const tracks = [{ trackhash: '6f1c0e2a9b3d4c5e', index: 3 }]
let fetch: ReturnType<typeof vi.fn>

beforeEach(() => {
    vi.clearAllMocks()
    useAxios.mockResolvedValue({ status: 200, data: { msg: 'Done' } })
    fetch = vi.fn().mockResolvedValue({ status: 200 })
    vi.stubGlobal('fetch', fetch)
})

afterEach(() => {
    vi.unstubAllGlobals()
})

describe('removeTracks over keepalive', () => {
    it('sends what the axios path sends, on a request that may outlive the page', async () => {
        expect(await removeTracks(7, tracks, false)).toBe(true)
        const { url, props, method } = useAxios.mock.calls[0][0]
        expect(method ?? 'POST').toBe('POST')

        expect(await removeTracks(7, tracks, false, { keepalive: true })).toBe(true)

        expect(useAxios).toHaveBeenCalledTimes(1)
        const [sentTo, init] = fetch.mock.calls[0]
        expect(sentTo).toBe(getBaseUrl() + url)
        expect(init).toMatchObject({ method: 'POST', keepalive: true, credentials: 'include' })
        expect(init.headers).toEqual({ 'Content-Type': 'application/json' })
        expect(JSON.parse(init.body)).toEqual(props)
    })

    it('reports a refusal', async () => {
        fetch.mockResolvedValue({ status: 500 })

        expect(await removeTracks(7, tracks, false, { keepalive: true })).toBe(false)
        expect(Notification).toHaveBeenCalledWith('Unable to remove tracks', 'error')
    })

    it('reports no answer at all as a failure, without throwing', async () => {
        fetch.mockRejectedValue(new TypeError('Failed to fetch'))

        expect(await removeTracks(7, tracks, false, { keepalive: true })).toBe(false)
        expect(Notification).toHaveBeenCalledWith('Unable to remove tracks', 'error')
    })
})
