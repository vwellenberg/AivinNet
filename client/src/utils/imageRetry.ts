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
// The budget (~2 min) covers a restart with room to spare; an image still
// failing after that has a problem a retry will not fix.
// ---------------------------------------------------------------------------

import { paths } from '@/config'

export const RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 15_000, 30_000, 60_000]

const RETRYABLE_BASES = [paths.images.thumb.large, paths.images.artist.large, paths.images.playlist]

export function isRetryableImage(src: string): boolean {
    if (!src) return false

    let url: URL
    try {
        url = new URL(src, window.location.href)
    } catch {
        return false
    }

    return RETRYABLE_BASES.some(base => {
        const prefix = new URL(base, window.location.href)
        return url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname)
    })
}

/** Retries spent per element, for the src they were spent on. */
const attempts = new WeakMap<HTMLImageElement, { src: string; n: number }>()

export function installImageRetry(root: Document = document): () => void {
    const timers = new Set<ReturnType<typeof setTimeout>>()

    function onError(e: Event) {
        const img = e.target
        if (!(img instanceof HTMLImageElement)) return

        const src = img.src
        if (!isRetryableImage(src)) return

        const prev = attempts.get(img)
        const n = prev && prev.src === src ? prev.n : 0
        if (n >= RETRY_DELAYS_MS.length) return
        attempts.set(img, { src, n: n + 1 })

        const timer = setTimeout(() => {
            timers.delete(timer)
            // Unmounted, or re-bound to another cover in the meantime: that
            // one loads (or fails) on its own.
            if (!img.isConnected || img.src !== src) return
            // Assigning the same value starts a new load (HTML: the src
            // attribute was set), and a failed request is not cached.
            img.src = src
        }, RETRY_DELAYS_MS[n])
        timers.add(timer)
    }

    function onLoad(e: Event) {
        if (e.target instanceof HTMLImageElement) attempts.delete(e.target)
    }

    root.addEventListener('error', onError, true)
    root.addEventListener('load', onLoad, true)

    return () => {
        root.removeEventListener('error', onError, true)
        root.removeEventListener('load', onLoad, true)
        timers.forEach(clearTimeout)
        timers.clear()
    }
}
