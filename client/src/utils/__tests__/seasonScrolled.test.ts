import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    PAGE_CONTENT_SELECTOR,
    SCROLL_SETTLE_MS,
    SEASON_SCROLLED_CLASS,
    isVerticalPageScroll,
    watchSeasonScroll,
    type SeasonScrollWatch,
} from '@/utils/seasonScrolled'

const root = () => document.documentElement

let watches: SeasonScrollWatch[] = []
function watch(options: Parameters<typeof watchSeasonScroll>[0] = {}): SeasonScrollWatch {
    const w = watchSeasonScroll(options)
    watches.push(w)
    return w
}

/**
 * An element with a scroll position we can move: jsdom has no layout, so
 * scrollTop, scrollLeft and the sizes are plain values here. A real scroller
 * has `scrollHeight > clientHeight` (it can scroll vertically).
 */
function scrollerElement(): HTMLElement {
    const el = document.createElement('div')
    let top = 0
    let left = 0
    Object.defineProperties(el, {
        scrollTop: {
            get: () => top,
            set: (v: number) => {
                top = v
            },
            configurable: true,
        },
        scrollLeft: {
            get: () => left,
            set: (v: number) => {
                left = v
            },
            configurable: true,
        },
        scrollHeight: { value: 3000, configurable: true },
        clientHeight: { value: 800, configurable: true },
    })
    return el
}

/** The page's content box, with the page scroller inside it (as in App.vue). */
let content: HTMLElement
let pageScroller: HTMLElement

/** Move an element's scroll position and fire the scroll event it would fire (no bubbling). */
function scrollTo(el: HTMLElement, to: { top?: number; left?: number }): void {
    if (to.top !== undefined) el.scrollTop = to.top
    if (to.left !== undefined) el.scrollLeft = to.left
    el.dispatchEvent(new Event('scroll', { bubbles: false }))
}

beforeEach(() => {
    vi.useFakeTimers()
    root().className = ''
    content = document.createElement('section')
    content.id = 'acontent'
    pageScroller = scrollerElement()
    pageScroller.classList.add('content-page')
    content.appendChild(pageScroller)
    document.body.appendChild(content)
})

afterEach(() => {
    for (const w of watches) w.stop()
    watches = []
    content.remove()
    vi.useRealTimers()
    root().className = ''
})

describe('watchSeasonScroll: a vertical scroll of the page', () => {
    it('sets the class when the page scroller really moves up or down', () => {
        watch()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        scrollTo(pageScroller, { top: 120 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(true)
    })

    it('drops the class and calls onSettle once the page has been still for the settle time', () => {
        const onSettle = vi.fn()
        watch({ onSettle })
        scrollTo(pageScroller, { top: 120 })

        vi.advanceTimersByTime(SCROLL_SETTLE_MS - 1)
        expect(onSettle).not.toHaveBeenCalled()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(true)

        vi.advanceTimersByTime(1)
        expect(onSettle).toHaveBeenCalledTimes(1)
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
    })

    it('waits again after every scroll event, so a scroll in progress never settles', () => {
        const onSettle = vi.fn()
        watch({ onSettle, settleMs: 500 })
        scrollTo(pageScroller, { top: 100 })
        vi.advanceTimersByTime(400)
        scrollTo(pageScroller, { top: 200 })
        vi.advanceTimersByTime(400)
        expect(onSettle).not.toHaveBeenCalled()
        vi.advanceTimersByTime(100)
        expect(onSettle).toHaveBeenCalledTimes(1)
    })

    it('reset() clears the class and the pending settle, without calling onSettle (route change)', () => {
        const onSettle = vi.fn()
        const w = watch({ onSettle })
        scrollTo(pageScroller, { top: 100 })
        w.reset()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
        expect(onSettle).not.toHaveBeenCalled()
    })

    it('stop() unhooks the listener: later scrolls do nothing', () => {
        const onSettle = vi.fn()
        const w = watch({ onSettle })
        w.stop()
        scrollTo(pageScroller, { top: 100 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
        expect(onSettle).not.toHaveBeenCalled()
    })
})

describe('watchSeasonScroll: what is NOT a page scroll', () => {
    it('ignores a horizontal scroll of a card row: scrollLeft moves, scrollTop does not', () => {
        watch()
        const row = scrollerElement()
        row.classList.add('recentitems')
        pageScroller.appendChild(row)
        scrollTo(row, { left: 240 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
    })

    it('ignores a horizontal scroll of the page scroller itself', () => {
        watch()
        scrollTo(pageScroller, { left: 40 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
    })

    it('ignores a scroll of an element outside the page content: the sidebar, the player', () => {
        watch()
        const sidebar = scrollerElement()
        document.body.appendChild(sidebar)
        scrollTo(sidebar, { top: 300 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        sidebar.remove()
    })

    it('ignores a scroll event that moved nothing (a virtual list measuring itself on load)', () => {
        const onSettle = vi.fn()
        watch({ onSettle })
        pageScroller.dispatchEvent(new Event('scroll'))
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
        expect(onSettle).not.toHaveBeenCalled()
    })

    it('ignores events whose target is the document, not an element', () => {
        watch()
        document.dispatchEvent(new Event('scroll'))
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
    })

    it('a steady stream of horizontal scrolls does not keep the tiles off', () => {
        const onSettle = vi.fn()
        watch({ onSettle })
        const row = scrollerElement()
        pageScroller.appendChild(row)
        for (let i = 1; i <= 20; i++) {
            scrollTo(row, { left: i * 10 })
            vi.advanceTimersByTime(100)
        }
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
    })
})

describe('isVerticalPageScroll', () => {
    it('counts a change of scrollTop on the page scroller, and remembers it', () => {
        const last = new WeakMap<Element, number>()
        expect(isVerticalPageScroll(pageScroller, last, () => true)).toBe(false)
        pageScroller.scrollTop = 80
        expect(isVerticalPageScroll(pageScroller, last, () => true)).toBe(true)
        // The same position again is not a new scroll.
        expect(isVerticalPageScroll(pageScroller, last, () => true)).toBe(false)
    })

    it('never counts an element the page-scroller test rejects', () => {
        const last = new WeakMap<Element, number>()
        pageScroller.scrollTop = 80
        expect(isVerticalPageScroll(pageScroller, last, () => false)).toBe(false)
    })

    it('takes its page-scroller test from the options, so another root can be used', () => {
        const onSettle = vi.fn()
        // A scroller outside #acontent, accepted by a custom test.
        const other = scrollerElement()
        document.body.appendChild(other)
        watch({ onSettle, isPageScroller: (el) => el === other })
        scrollTo(other, { top: 50 })
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(true)
        other.remove()
    })

    it('scopes the default page test to the page content box', () => {
        expect(PAGE_CONTENT_SELECTOR).toBe('#acontent')
    })
})
