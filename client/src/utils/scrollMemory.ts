/**
 * A page's scroll position per history entry, for "Back".
 *
 * Home scrolls in its own element (`.homepageview`), not the window, and the
 * element is built anew on every visit — so neither the browser nor Vue
 * Router's `savedPosition` brings the place back, and Back from an album
 * landed at the top of Home.
 *
 * Kept per entry (`history.state.position`, Vue Router's own counter) and
 * restored only when the entry has a `forward` — Vue Router sets that on an
 * entry when it pushes the next one, so it is there when the user comes back
 * to it and missing on a fresh visit (a click on "Home" starts at the top).
 * A fresh visit also forgets what was kept under its position: an earlier
 * entry with the same number was cut off by the push and is gone.
 */

export type HistoryEntry = { position?: unknown; forward?: unknown } | null | undefined

export function createScrollMemory() {
    const kept = new Map<number, number>()

    return {
        /** Where to start on this entry: the kept place on a return, else the top. */
        enter(entry: HistoryEntry): number {
            const position = entry?.position
            if (typeof position !== 'number') return 0
            if (!entry?.forward) {
                kept.delete(position)
                return 0
            }
            return kept.get(position) ?? 0
        },
        keep(entry: HistoryEntry, top: number) {
            const position = entry?.position
            if (typeof position === 'number') kept.set(position, top)
        },
    }
}

/**
 * Scroll `el` to `top` once the content is tall enough to get there. The rows
 * come from the store and render at once, but a card above them may load
 * itself a moment later; give up after `ms`, or as soon as the user scrolls.
 */
export function scrollWhenReady(el: HTMLElement, top: number, ms = 1500): () => void {
    if (top <= 0) return () => {}

    let frame = 0
    const until = performance.now() + ms
    const stop = () => {
        cancelAnimationFrame(frame)
        el.removeEventListener('wheel', stop)
        el.removeEventListener('touchstart', stop)
    }
    el.addEventListener('wheel', stop, { passive: true })
    el.addEventListener('touchstart', stop, { passive: true })

    const attempt = () => {
        el.scrollTop = top
        if (Math.abs(el.scrollTop - top) <= 1 || performance.now() > until) return stop()
        frame = requestAnimationFrame(attempt)
    }
    attempt()
    return stop
}

/** Home's places, for the life of the tab. */
export const homeScroll = createScrollMemory()
