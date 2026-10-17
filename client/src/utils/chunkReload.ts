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
// So: reload onto the page that was asked for. Guarded three times —
//   - a reload swaps the running player for whatever the server answers, and
//     with no server that is the browser's error page: playback gone, queue
//     gone. Offline, wait for the `online` event; and either way, ask the
//     server first. `navigator.onLine` only knows about the network adapter —
//     a phone whose connection to the server dropped for a few seconds still
//     says `true`.
//   - a chunk that fails again right after a reload is a real server problem,
//     not a stale tab; reloading again would loop forever.
//   - that guard has to survive the reload, so it lives where a reload cannot
//     wipe it: sessionStorage, and the history entry as well, for when storage
//     is blocked (site data off, a sandboxed frame) and the loop would
//     otherwise be unguarded.
// ---------------------------------------------------------------------------

import type { Router } from 'vue-router'

import { Notification, NotifType } from '@/stores/notification'

const CHUNK_ERROR =
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|Loading (CSS )?chunk .* failed/i

/** Within this window after a reload, a second chunk failure does not reload again. */
export const RELOAD_GUARD_MS = 10_000
/** How long the server gets to answer before a reload counts as a jump into nothing. */
export const PROBE_TIMEOUT_MS = 5_000
const GUARD_KEY = 'aivinnet:chunk-reload-at'

export function isChunkLoadError(err: unknown): boolean {
    const message = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
    return CHUNK_ERROR.test(message)
}

function readGuard(): number {
    let at = 0
    try {
        at = Number(sessionStorage.getItem(GUARD_KEY)) || 0
    } catch {
        // No storage: the history entry below still knows.
    }
    return Math.max(at, Number(history.state?.[GUARD_KEY]) || 0)
}

function writeGuard(at: number) {
    try {
        sessionStorage.setItem(GUARD_KEY, String(at))
    } catch {
        // No storage (blocked site data, a sandboxed frame): the history entry
        // carries the guard on its own — see reloadIfServerAnswers().
    }
}

/**
 * Whether the server answers right now. Asks for the document a reload would
 * fetch, past every cache, and gives up after PROBE_TIMEOUT_MS: a connection
 * that hangs is as dead as one that fails.
 */
async function serverAnswers(): Promise<boolean> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS)
    try {
        const res = await fetch(location.pathname + location.search, {
            cache: 'no-store',
            signal: controller.signal,
        })
        return res.ok
    } catch {
        return false
    } finally {
        clearTimeout(timer)
    }
}

/** A probe is out, or the tab waits for `online`: later failures only update the target. */
let waiting = false
/** The latest page asked for while waiting — the one to land on. */
let pendingHash = ''

async function reloadIfServerAnswers() {
    const answers = await serverAnswers()
    waiting = false

    if (!answers) {
        // Stay on the page that plays. The failed chunk stays cached, so the
        // next tap lands here again and asks the server again.
        new Notification('Can’t reach the server — try again in a moment', NotifType.Error)
        return
    }

    const at = Date.now()
    writeGuard(at)
    // replaceState, not `location.hash = …`: that would fire the router,
    // which would try the dead chunk once more before the reload. The router
    // keeps foreign keys in the entry's state, so the guard survives it.
    history.replaceState({ ...history.state, [GUARD_KEY]: at }, '', pendingHash)
    location.reload()
}

/**
 * Reloads the tab onto `hash` (the router's `#/…` target) when `err` is a failed
 * chunk load and the server answers. Returns whether it handled the error.
 */
export function reloadOnChunkError(err: unknown, hash: string, now = Date.now()): boolean {
    if (!isChunkLoadError(err)) return false

    if (now - readGuard() < RELOAD_GUARD_MS) {
        console.error('Page code failed to load again right after a reload — not reloading again.', err)
        return true
    }

    pendingHash = hash
    if (waiting) return true
    waiting = true

    if (navigator.onLine === false) {
        window.addEventListener('online', () => void reloadIfServerAnswers(), { once: true })
        return true
    }

    void reloadIfServerAnswers()
    return true
}

/** Wires the reload into a router: a failed page chunk reloads onto the page asked for. */
export function installChunkReload(router: Router) {
    return router.onError((err, to) => {
        reloadOnChunkError(err, '#' + to.fullPath)
    })
}

export function __resetChunkReloadTestState() {
    waiting = false
    pendingHash = ''
    try {
        sessionStorage.removeItem(GUARD_KEY)
    } catch {
        // no storage
    }
    history.replaceState(null, '')
}
