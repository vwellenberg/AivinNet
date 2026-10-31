import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { SCROLL_SETTLE_MS, SEASON_SCROLLED_CLASS, watchSeasonScroll, type SeasonScrollWatch } from '@/utils/seasonScrolled'

const root = () => document.documentElement

let watches: SeasonScrollWatch[] = []
function watch(options: Parameters<typeof watchSeasonScroll>[0] = {}): SeasonScrollWatch {
    const w = watchSeasonScroll(options)
    watches.push(w)
    return w
}

/** A scroll on an element deep in the page: scroll events do not bubble. */
function scrollSomewhere(): void {
    const el = document.createElement('div')
    document.body.appendChild(el)
    el.dispatchEvent(new Event('scroll', { bubbles: false }))
    el.remove()
}

beforeEach(() => {
    vi.useFakeTimers()
    root().className = ''
})

afterEach(() => {
    for (const w of watches) w.stop()
    watches = []
    vi.useRealTimers()
    root().className = ''
})

describe('watchSeasonScroll', () => {
    it('sets the class on the page when anything scrolls, not only the window', () => {
        watch()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        scrollSomewhere()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(true)
    })

    it('drops the class and calls onSettle once the page has been still for the settle time', () => {
        const onSettle = vi.fn()
        watch({ onSettle })
        scrollSomewhere()

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
        scrollSomewhere()
        vi.advanceTimersByTime(400)
        scrollSomewhere()
        vi.advanceTimersByTime(400)
        expect(onSettle).not.toHaveBeenCalled()
        vi.advanceTimersByTime(100)
        expect(onSettle).toHaveBeenCalledTimes(1)
    })

    it('reset() clears the class and the pending settle, without calling onSettle (route change)', () => {
        const onSettle = vi.fn()
        const w = watch({ onSettle })
        scrollSomewhere()
        w.reset()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
        expect(onSettle).not.toHaveBeenCalled()
    })

    it('stop() unhooks the listener: later scrolls do nothing', () => {
        const onSettle = vi.fn()
        const w = watch({ onSettle })
        w.stop()
        scrollSomewhere()
        expect(root().classList.contains(SEASON_SCROLLED_CLASS)).toBe(false)
        vi.advanceTimersByTime(SCROLL_SETTLE_MS * 2)
        expect(onSettle).not.toHaveBeenCalled()
    })
})
