/**
 * "The page is being scrolled" for the Halloween decorations (utils/seasonTileEmojis.ts).
 *
 * A capture-phase, passive `scroll` listener on the document catches the scroll
 * of every scroller on the page (the album grid, the sidebar, the virtual
 * lists), because scroll events do not bubble but do pass the capture phase.
 * While it runs, `html.season-scrolled` is set: the decorations fade. After
 * the page has been still for `settleMs`, the class goes and `onSettle` runs,
 * which is the moment the decorations start again from nothing.
 */

export const SEASON_SCROLLED_CLASS = 'season-scrolled'

/** Idle time after the last scroll event before the page counts as still. */
export const SCROLL_SETTLE_MS = 500

export interface SeasonScrollWatch {
    /** A new page: drop the class and the pending settle, without `onSettle`. */
    reset(): void
    /** Unhook the listener and drop the class. */
    stop(): void
}

export interface SeasonScrollOptions {
    /** Where the class goes. Default: the `<html>` element. */
    root?: HTMLElement
    /** Where the listener goes. Default: the document. */
    target?: Document
    settleMs?: number
    onSettle?: () => void
}

export function watchSeasonScroll(options: SeasonScrollOptions = {}): SeasonScrollWatch {
    const root = options.root ?? document.documentElement
    const target = options.target ?? document
    const settleMs = options.settleMs ?? SCROLL_SETTLE_MS
    let timer: ReturnType<typeof setTimeout> | undefined

    const cancel = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
    }

    const onScroll = () => {
        root.classList.add(SEASON_SCROLLED_CLASS)
        cancel()
        timer = setTimeout(() => {
            timer = undefined
            root.classList.remove(SEASON_SCROLLED_CLASS)
            options.onSettle?.()
        }, settleMs)
    }

    target.addEventListener('scroll', onScroll, { capture: true, passive: true })

    return {
        reset() {
            cancel()
            root.classList.remove(SEASON_SCROLLED_CLASS)
        },
        stop() {
            cancel()
            target.removeEventListener('scroll', onScroll, { capture: true })
            root.classList.remove(SEASON_SCROLLED_CLASS)
        },
    }
}
