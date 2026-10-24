import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

const { Notification } = vi.hoisted(() => ({ Notification: vi.fn() }))
vi.mock('@/stores/notification', () => ({ Notification, NotifType: { Error: 'error' } }))

import {
    __resetChunkReloadTestState,
    installChunkReload,
    isChunkLoadError,
    PROBE_TIMEOUT_MS,
    RELOAD_GUARD_MS,
    reloadOnChunkError,
} from '@/utils/chunkReload'

// What the browsers actually throw when a lazy chunk cannot be fetched.
const CHROME = new TypeError('Failed to fetch dynamically imported module: http://host:1970/assets/AlbumListView-3f2a9c1e.js')
const FIREFOX = new TypeError('error loading dynamically imported module: http://host:1970/assets/AlbumListView-3f2a9c1e.js')
const SAFARI = new TypeError('Importing a module script failed.')
const VITE_CSS = new Error('Unable to preload CSS for /assets/AlbumListView-9b1d0c44.css')

let reload: ReturnType<typeof vi.fn>
let replaceState: MockInstance<History['replaceState']>
let probe: ReturnType<typeof vi.fn>

function setOnline(online: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

/** The probe and the reload behind it run on promises. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** The server answers the probe. */
const answers = () => Promise.resolve({ ok: true } as Response)
/** No server: a connection that is refused fails at once. */
const refuses = () => Promise.reject(new TypeError('Failed to fetch'))

beforeEach(() => {
    __resetChunkReloadTestState()
    Notification.mockClear()
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    probe = vi.fn(answers)
    vi.stubGlobal('fetch', probe)
    replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    setOnline(true)
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
})

describe('isChunkLoadError', () => {
    it.each([CHROME, FIREFOX, SAFARI, VITE_CSS])('recognises %s', err => {
        expect(isChunkLoadError(err)).toBe(true)
    })

    it('leaves every other error alone', () => {
        expect(isChunkLoadError(new Error('Request failed with status code 500'))).toBe(false)
        expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false)
        expect(isChunkLoadError(undefined)).toBe(false)
    })
})

describe('the router after a page chunk failed to load', () => {
    function routerWithDeadChunk() {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { template: '<div />' } },
                // A page whose chunk the dropped connection never delivered: the
                // browser caches the failure, so every retry rejects the same way.
                { path: '/albums', component: () => Promise.reject(CHROME) },
            ],
        })
        installChunkReload(router)
        return router
    }

    it('reloads onto the page that was asked for instead of silently staying put', async () => {
        const router = routerWithDeadChunk()
        await router.push('/')

        await router.push('/albums?sort=title').catch(() => {})
        await settle()

        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(expect.anything(), '', '#/albums?sort=title')
    })

    it('does not reload for an ordinary navigation error', async () => {
        const router = createRouter({
            history: createMemoryHistory(),
            routes: [
                { path: '/', component: { template: '<div />' } },
                { path: '/boom', component: { template: '<div />' }, beforeEnter: () => { throw new Error('guard bug') } },
            ],
        })
        installChunkReload(router)
        await router.push('/')

        await router.push('/boom').catch(() => {})
        await settle()

        expect(reload).not.toHaveBeenCalled()
        expect(probe).not.toHaveBeenCalled()
    })
})

describe('reloadOnChunkError guards', () => {
    it('does not loop: a second failure right after a reload stays put', async () => {
        const t0 = 1_000_000
        vi.spyOn(Date, 'now').mockReturnValue(t0)
        reloadOnChunkError(CHROME, '#/albums', t0)
        await settle()
        expect(reload).toHaveBeenCalledTimes(1)

        vi.spyOn(console, 'error').mockImplementation(() => {})
        reloadOnChunkError(CHROME, '#/albums', t0 + 2_000)
        await settle()
        expect(reload).toHaveBeenCalledTimes(1)

        reloadOnChunkError(CHROME, '#/albums', t0 + RELOAD_GUARD_MS + 1)
        await settle()
        expect(reload).toHaveBeenCalledTimes(2)
    })

    // #299: blocked site data or a sandboxed frame makes sessionStorage throw.
    // The guard used to live there alone, so with a stale index that names a
    // removed chunk every reload failed again and the tab reloaded for ever.
    it('does not loop when sessionStorage is blocked: the history entry carries the guard', async () => {
        const blocked = () => {
            throw new DOMException('The operation is insecure.', 'SecurityError')
        }
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
        vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
        replaceState.mockRestore() // the real entry, which outlives a reload
        vi.spyOn(console, 'error').mockImplementation(() => {})

        const t0 = Date.now()
        reloadOnChunkError(CHROME, '#/albums', t0)
        await settle()
        expect(reload).toHaveBeenCalledTimes(1)

        // The reloaded document fails the same chunk a moment later.
        reloadOnChunkError(CHROME, '#/albums', t0 + 2_000)
        await settle()
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('offline: waits for the connection, then lands on the latest page asked for', async () => {
        setOnline(false)

        reloadOnChunkError(CHROME, '#/albums')
        reloadOnChunkError(CHROME, '#/artists')
        await settle()
        expect(reload).not.toHaveBeenCalled()
        expect(probe).not.toHaveBeenCalled()

        window.dispatchEvent(new Event('online'))
        await settle()

        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(expect.anything(), '', '#/artists')
    })
})

// #299: `navigator.onLine` only knows the network adapter. A phone whose link
// to the server dropped for a few seconds still says `true` — and a reload then
// replaced the playing app with the browser's error page.
describe('a reload only goes ahead when the server answers', () => {
    it('stays on the playing page and says why when the server does not answer', async () => {
        probe.mockImplementation(refuses)

        reloadOnChunkError(CHROME, '#/stats')
        await settle()

        expect(probe).toHaveBeenCalledTimes(1)
        expect(probe.mock.calls[0][1]).toMatchObject({ cache: 'no-store' })
        expect(reload).not.toHaveBeenCalled()
        expect(replaceState).not.toHaveBeenCalled()
        expect(Notification).toHaveBeenCalledTimes(1)
    })

    it('asks again on the next tap, and reloads once the server is back', async () => {
        probe.mockImplementationOnce(refuses)
        reloadOnChunkError(CHROME, '#/stats')
        await settle()
        expect(reload).not.toHaveBeenCalled()

        reloadOnChunkError(CHROME, '#/stats')
        await settle()

        expect(probe).toHaveBeenCalledTimes(2)
        expect(reload).toHaveBeenCalledTimes(1)
    })

    it('treats an error page from a proxy as no answer', async () => {
        probe.mockResolvedValue({ ok: false, status: 502 } as Response)

        reloadOnChunkError(CHROME, '#/stats')
        await settle()

        expect(reload).not.toHaveBeenCalled()
    })

    it('gives a server that hangs PROBE_TIMEOUT_MS, then stays put', async () => {
        vi.useFakeTimers()
        probe.mockImplementation(
            (_url: string, init: { signal?: AbortSignal }) =>
                new Promise((_resolve, reject) =>
                    init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
                )
        )

        reloadOnChunkError(CHROME, '#/stats')
        await vi.advanceTimersByTimeAsync(PROBE_TIMEOUT_MS - 1)
        expect(Notification).not.toHaveBeenCalled()

        await vi.advanceTimersByTimeAsync(1)
        expect(reload).not.toHaveBeenCalled()
        expect(Notification).toHaveBeenCalledTimes(1)
    })

    it('sends one probe while one is out, and lands on the latest page asked for', async () => {
        let answer: (r: Response) => void = () => {}
        probe.mockImplementation(() => new Promise<Response>(resolve => (answer = resolve)))

        reloadOnChunkError(CHROME, '#/albums')
        reloadOnChunkError(CHROME, '#/artists')
        answer({ ok: true } as Response)
        await settle()

        expect(probe).toHaveBeenCalledTimes(1)
        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(expect.anything(), '', '#/artists')
    })

    it('asks the server after coming back online, too', async () => {
        setOnline(false)
        probe.mockImplementation(refuses)

        reloadOnChunkError(CHROME, '#/albums')
        window.dispatchEvent(new Event('online'))
        await settle()

        expect(probe).toHaveBeenCalledTimes(1)
        expect(reload).not.toHaveBeenCalled()
    })
})
