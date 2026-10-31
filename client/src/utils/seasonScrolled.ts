/**
 * "The page is being scrolled" for the Halloween decorations (utils/seasonTileEmojis.ts).
 *
 * A capture-phase, passive `scroll` listener on the document sees the scroll of
 * every element (scroll events do not bubble, but do pass the capture phase).
 * Only a VERTICAL scroll of the PAGE counts: the scroller inside `#acontent`
 * (the `.content-page` of the view, or a virtual list in it) whose `scrollTop`
 * really moved. Everything else is ignored, because it used to keep the tiles
 * switched off all the time: the horizontal card rows on Home, the sidebar, a
 * virtual list measuring itself on load, a programmatic scroll, a marquee.
 *
 * While a real page scroll runs, `html.season-scrolled` is set: the decorations
 * fade. After the page has been still for `settleMs`, the class goes and
 * `onSettle` runs, which is the moment the decorations start again from nothing.
 */

export const SEASON_SCROLLED_CLASS = 'season-scrolled'

/** Idle time after the last scroll event before the page counts as still. */
export const SCROLL_SETTLE_MS = 500

/** The element that holds the page's content: every page scroller lives inside it. */
export const PAGE_CONTENT_SELECTOR = '#acontent'

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
    /**
     * Whether a scrolled element is the page's own scroller. Default: it sits
     * inside `#acontent` (PAGE_CONTENT_SELECTOR). The vertical movement is
     * checked on top of this, whatever the answer here.
     */
    isPageScroller?: (el: Element) => boolean
}

/** The default page-scroller test: an element inside the page content, not the content box itself. */
export function isInPageContent(el: Element): boolean {
    return el.closest(PAGE_CONTENT_SELECTOR) !== null
}

/**
 * Whether a scroll event on `el` is a vertical scroll of the page: the element
 * is the page scroller and its `scrollTop` moved since the last event seen for
 * it. `lastTop` remembers that per element; a new element starts at 0. A
 * horizontal scroll leaves `scrollTop` where it was and so does not count.
 */
export function isVerticalPageScroll(
    el: Element,
    lastTop: WeakMap<Element, number>,
    isPageScroller: (el: Element) => boolean
): boolean {
    const top = el.scrollTop
    const before = lastTop.get(el) ?? 0
    lastTop.set(el, top)
    if (!isPageScroller(el)) return false
    return top !== before
}

export function watchSeasonScroll(options: SeasonScrollOptions = {}): SeasonScrollWatch {
    const root = options.root ?? document.documentElement
    const target = options.target ?? document
    const settleMs = options.settleMs ?? SCROLL_SETTLE_MS
    const isPageScroller = options.isPageScroller ?? isInPageContent
    const lastTop = new WeakMap<Element, number>()
    let timer: ReturnType<typeof setTimeout> | undefined

    const cancel = () => {
        if (timer !== undefined) clearTimeout(timer)
        timer = undefined
    }

    const onScroll = (event: Event) => {
        const el = event.target
        // The document itself, or a node that is not an element, is never the page scroller.
        if (!(el instanceof Element)) return
        if (!isVerticalPageScroll(el, lastTop, isPageScroller)) return

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
