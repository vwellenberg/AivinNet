// ---------------------------------------------------------------------------
// A page whose code chunk failed to load is dead until the tab reloads.
//
// Every page except Home is a lazy chunk (router/index.ts). When fetching one
// fails — a dropped connection, or a deploy that renamed the hashed files under
// an open tab — the browser caches the FAILED module: every later import of the
// same URL rejects at once, without a new request. Vue Router swallows that
// rejection and stays where it is, so the nav buttons simply did nothing, even
// after the connection was back. The only cure is a fresh document.
//
// So: reload onto the page that was asked for. Guarded twice —
//   - offline, a reload would swap the running player for the browser's error
//     page; wait for the `online` event instead.
//   - a chunk that fails again right after a reload is a real server problem,
//     not a stale tab; reloading again would loop forever.
// ---------------------------------------------------------------------------

import type { Router } from 'vue-router'

const CHUNK_ERROR =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk .* failed/i

/** Within this window after a reload, a second chunk failure does not reload again. */
export const RELOAD_GUARD_MS = 10_000
const GUARD_KEY = 'aivinnet:chunk-reload-at'

export function isChunkLoadError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    return CHUNK_ERROR.test(message)
}

function readGuard(): number {
    try {
        return Number(sessionStorage.getItem(GUARD_KEY)) || 0
    } catch {
        return 0
    }
}

function writeGuard(at: number) {
    try {
        sessionStorage.setItem(GUARD_KEY, String(at))
    } catch {
        // No storage (private mode): reload anyway — a loop needs a second
        // failure within seconds, which a missing guard only makes possible.
    }
}

let waitingForOnline = false
/** The latest page asked for while offline — the one to land on once back. */
let pendingHash = ''

/**
 * Reloads the tab onto `hash` (the router's `#/…` target) when `err` is a failed
 * chunk load. Returns whether it handled the error.
 */
export function reloadOnChunkError(err: unknown, hash: string, now = Date.now()): boolean {
    if (!isChunkLoadError(err)) return false

    if (now - readGuard() < RELOAD_GUARD_MS) {
        console.error('Page code failed to load again right after a reload — not reloading again.', err)
        return true
    }

    pendingHash = hash
    const reload = () => {
        writeGuard(Date.now())
        // replaceState, not `location.hash = …`: that would fire the router,
        // which would try the dead chunk once more before the reload.
        history.replaceState(history.state, '', pendingHash)
        location.reload()
    }

    if (navigator.onLine === false) {
        if (!waitingForOnline) {
            waitingForOnline = true
            window.addEventListener(
                'online',
                () => {
                    waitingForOnline = false
                    reload()
                },
                { once: true }
            )
        }
        return true
    }

    reload()
    return true
}

/** Wires the reload into a router: a failed page chunk reloads onto the page asked for. */
export function installChunkReload(router: Router) {
    return router.onError((err, to) => {
        reloadOnChunkError(err, '#' + to.fullPath)
    })
}

export function __resetChunkReloadTestState() {
    waitingForOnline = false
    pendingHash = ''
    try {
        sessionStorage.removeItem(GUARD_KEY)
    } catch {
        // no storage
    }
}
