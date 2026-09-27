import { afterEach, beforeEach, describe, expect, it, vi, type SpyInstance } from 'vitest'
import { createMemoryHistory, createRouter } from 'vue-router'

import {
    __resetChunkReloadTestState,
    installChunkReload,
    isChunkLoadError,
    RELOAD_GUARD_MS,
    reloadOnChunkError,
} from '@/utils/chunkReload'

// What the browsers actually throw when a lazy chunk cannot be fetched.
const CHROME = new TypeError('Failed to fetch dynamically imported module: http://host:1970/assets/AlbumListView-3f2a9c1e.js')
const FIREFOX = new TypeError('error loading dynamically imported module: http://host:1970/assets/AlbumListView-3f2a9c1e.js')
const SAFARI = new TypeError('Importing a module script failed.')
const VITE_CSS = new Error('Unable to preload CSS for /assets/AlbumListView-9b1d0c44.css')

let reload: ReturnType<typeof vi.fn>
let replaceState: SpyInstance<Parameters<History['replaceState']>, void>

function setOnline(online: boolean) {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
}

beforeEach(() => {
    __resetChunkReloadTestState()
    reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    replaceState = vi.spyOn(history, 'replaceState').mockImplementation(() => {})
    setOnline(true)
})

afterEach(() => {
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

        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(null, '', '#/albums?sort=title')
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

        expect(reload).not.toHaveBeenCalled()
    })
})

describe('reloadOnChunkError guards', () => {
    it('does not loop: a second failure right after a reload stays put', () => {
        const t0 = 1_000_000
        vi.spyOn(Date, 'now').mockReturnValue(t0)
        reloadOnChunkError(CHROME, '#/albums', t0)
        expect(reload).toHaveBeenCalledTimes(1)

        vi.spyOn(console, 'error').mockImplementation(() => {})
        reloadOnChunkError(CHROME, '#/albums', t0 + 2_000)
        expect(reload).toHaveBeenCalledTimes(1)

        reloadOnChunkError(CHROME, '#/albums', t0 + RELOAD_GUARD_MS + 1)
        expect(reload).toHaveBeenCalledTimes(2)
    })

    it('offline: waits for the connection, then lands on the latest page asked for', () => {
        setOnline(false)

        reloadOnChunkError(CHROME, '#/albums')
        reloadOnChunkError(CHROME, '#/artists')
        expect(reload).not.toHaveBeenCalled()

        window.dispatchEvent(new Event('online'))

        expect(reload).toHaveBeenCalledTimes(1)
        expect(replaceState).toHaveBeenCalledWith(null, '', '#/artists')
    })
})
