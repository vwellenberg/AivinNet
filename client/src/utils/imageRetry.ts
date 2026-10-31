// ---------------------------------------------------------------------------
// A cover that failed to load once stayed broken until the tab reloaded.
//
// An <img> whose request fails shows the broken-image icon and never asks
// again — the browser has no retry of its own, and Vue only touches `src` when
// the bound value changes. The server restarts on every backend deploy, so a
// client that loaded (or reloaded) in those few seconds lost its covers for
// good. Measured: a 3 s outage at boot left all 75 sidebar covers broken, and
// they were still broken 50 s after the server was back.
//
// So: one capture-phase listener for the whole app (`error` does not bubble,
// but it does pass through the capture phase), which loads a failed cover
// again after a backoff. Only for the image routes whose server side always
// answers with an image — a missing cover comes back as the placeholder, not
// as an error (api/imgserver.py, `send_file_or_fallback`). On those routes an
// error means the request itself failed, which is exactly what is worth
// another try. User avatars are left out: their 404 is a real answer that
// Avatar.vue turns into the generated avatar.
//
// The budget (~2-3 min) covers a restart with room to spare. Past it, an
// image waits for the user to come back to the tab or the network.
// ---------------------------------------------------------------------------

import { paths } from '@/config'

export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]
/** Each wait is stretched by up to this share, so a list of failed covers does not come back as one burst. */
export const JITTER = 0.5

const RETRYABLE_BASES = [paths.images.thumb.large, paths.images.artist.large, paths.images.playlist]

function resolvedPrefixes(): URL[] {
    return RETRYABLE_BASES.map(base => new URL(base, window.location.href))
}

export function isRetryableImage(src: string, prefixes: URL[] = resolvedPrefixes()): boolean {
    if (!src) return false

    let url: URL
    try {
        url = new URL(src, window.location.href)
    } catch {
        return false
    }

    return prefixes.some(prefix => url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname))
}

export function installImageRetry(root: Document = document): () => void {
    const prefixes = resolvedPrefixes()
    /** Retries spent per element, for the src they were spent on. */
    const attempts = new WeakMap<HTMLImageElement, { src: string; n: number }>()
    /** Images that used up their budget — tried once more when the user is back. */
    const exhausted = new Set<HTMLImageElement>()
    const timers = new Set<ReturnType<typeof setTimeout>>()

    function reload(img: HTMLImageElement, src: string) {
        // Unmounted, or re-bound to another cover in the meantime: that
        // one loads (or fails) on its own.
        if (!img.isConnected || img.src !== src) return
        // Assigning the same value starts a new load (HTML: the src
        // attribute was set), and a failed request is not cached.
        img.src = src
    }

    function onError(e: Event) {
        const img = e.target
        if (!(img instanceof HTMLImageElement)) return

        const src = img.src
        if (!isRetryableImage(src, prefixes)) return

        const prev = attempts.get(img)
        const n = prev && prev.src === src ? prev.n : 0
        if (n >= RETRY_DELAYS_MS.length) {
            exhausted.add(img)
            return
        }
        attempts.set(img, { src, n: n + 1 })

        const delay = RETRY_DELAYS_MS[n] * (1 + Math.random() * JITTER)
        const timer = setTimeout(() => {
            timers.delete(timer)
            reload(img, src)
        }, delay)
        timers.add(timer)
    }

    function onLoad(e: Event) {
        if (e.target instanceof HTMLImageElement) {
            attempts.delete(e.target)
            exhausted.delete(e.target)
        }
    }

    // An outage longer than the budget (laptop asleep, phone off the network)
    // would otherwise leave the covers broken after all. Coming back to the
    // tab or the network gets every one of them a fresh budget.
    function rearm() {
        if (root.visibilityState === 'hidden') return
        for (const img of exhausted) {
            exhausted.delete(img)
            attempts.delete(img)
            reload(img, img.src)
        }
    }

    root.addEventListener('error', onError, true)
    root.addEventListener('load', onLoad, true)
    root.addEventListener('visibilitychange', rearm)
    window.addEventListener('online', rearm)

    return () => {
        root.removeEventListener('error', onError, true)
        root.removeEventListener('load', onLoad, true)
        root.removeEventListener('visibilitychange', rearm)
        window.removeEventListener('online', rearm)
        timers.forEach(clearTimeout)
        timers.clear()
        exhausted.clear()
    }
}
