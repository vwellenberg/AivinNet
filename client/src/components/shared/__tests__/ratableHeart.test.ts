import { createPinia, setActivePinia } from 'pinia'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The player bar's heart rates the playing track as its SECOND gesture (user,
// 2026-11-21: "Rechtsklick auf Herz für Sternwertung — die Leiste unten will ich
// eigentlich gar nicht so voll haben"). A click or tap still toggles the
// favourite; right-click or a long-press opens the stars and must NOT toggle it
// too. The ratings store is the real one, so the per-hash publishing and the
// optimistic write are what is under test; only the HTTP calls are mocked.

const { setTrackRating, clearTrackRating, getAllTrackRatings } = vi.hoisted(() => ({
    setTrackRating: vi.fn(),
    clearTrackRating: vi.fn(),
    getAllTrackRatings: vi.fn(),
}))
vi.mock('@/requests/rating', () => ({ setTrackRating, clearTrackRating, getAllTrackRatings }))

import vContextMenu, { LONG_PRESS_MS } from '@/directives/vContextMenu'
import useContextStore from '@/stores/context'
import useRatings, { __resetRatingsTestState } from '@/stores/ratings'
import RatableHeart from '../RatableHeart.vue'

// An xxh3 trackhash, as the running server hands them out.
const HASH = '9f86d081884c7d65'
const OTHER = 'e3b0c44298fc1c14'

const mounted: VueWrapper[] = []

function mountHeart(props: Record<string, unknown> = {}) {
    const w = mount(RatableHeart, {
        props: { trackhash: HASH, rating: null, state: false, btn_role: 'bar', ...props },
        attachTo: document.body,
        global: { directives: { 'context-menu': vContextMenu } },
    })
    mounted.push(w)
    return w
}

const heart = (w: VueWrapper) => w.find('button.heart-button').element as HTMLElement
// The picker is teleported to <body>, outside the wrapper.
const picker = () => document.querySelector<HTMLElement>('.heart-rating-picker')
const stars = () => [...document.querySelectorAll<HTMLButtonElement>('.heart-rating-picker .rating-star')]

function rightClick(el: Element) {
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 640, clientY: 860 })
    el.dispatchEvent(ev)
    return ev
}

function touch(el: Element, type: string, points: { x: number; y: number }[] = []) {
    const ev = new Event(type, { bubbles: true, cancelable: true })
    Object.defineProperty(ev, 'touches', { value: points.map(p => ({ clientX: p.x, clientY: p.y })) })
    el.dispatchEvent(ev)
    return ev
}

/** What the browser does after a touch it was not told to cancel: a click. */
function clickUnlessCancelled(el: Element, touchEnd: Event) {
    if (!touchEnd.defaultPrevented) el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

beforeEach(() => {
    setActivePinia(createPinia())
    __resetRatingsTestState()
    setTrackRating.mockReset().mockResolvedValue(true)
    clearTrackRating.mockReset().mockResolvedValue(true)
})

afterEach(() => {
    vi.useRealTimers()
    // Unmount first: the picker is teleported into <body>, and wiping <body>
    // under a mounted component breaks its unmount.
    mounted.splice(0).forEach(w => w.unmount())
    document.body.innerHTML = ''
})

describe('RatableHeart: the gestures', () => {
    it('toggles the favourite on a click and opens nothing', async () => {
        const w = mountHeart()

        heart(w).click()
        await flushPromises()

        expect(w.emitted('handleFav')).toHaveLength(1)
        expect(picker()).toBeNull()
    })

    it('opens the stars on a right-click and does not toggle the favourite', async () => {
        const w = mountHeart()

        const ev = rightClick(heart(w))
        await flushPromises()

        // The browser's own menu stays shut.
        expect(ev.defaultPrevented).toBe(true)
        expect(picker()).not.toBeNull()
        expect(stars()).toHaveLength(5)
        expect(w.emitted('handleFav')).toBeUndefined()
        expect(heart(w).getAttribute('aria-expanded')).toBe('true')
    })

    it('opens the stars on a long-press, and the lifted finger does not toggle the favourite', async () => {
        vi.useFakeTimers()
        const w = mountHeart()
        const el = heart(w)

        touch(el, 'touchstart', [{ x: 600, y: 850 }])
        vi.advanceTimersByTime(LONG_PRESS_MS)
        await flushPromises()
        expect(picker()).not.toBeNull()

        const end = touch(el, 'touchend')
        clickUnlessCancelled(el, end)
        // A browser that sends the click anyway: the directive eats it too.
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
        await flushPromises()

        expect(w.emitted('handleFav')).toBeUndefined()
        expect(picker()).not.toBeNull()
    })

    it('still toggles the favourite on a short tap', async () => {
        vi.useFakeTimers()
        const w = mountHeart()
        const el = heart(w)

        touch(el, 'touchstart', [{ x: 600, y: 850 }])
        vi.advanceTimersByTime(120)
        const end = touch(el, 'touchend')
        clickUnlessCancelled(el, end)
        vi.advanceTimersByTime(LONG_PRESS_MS * 2)
        await flushPromises()

        expect(w.emitted('handleFav')).toHaveLength(1)
        expect(picker()).toBeNull()
    })

    it('closes an open track menu, so two menus never stand side by side', async () => {
        const context = useContextStore()
        context.visible = true
        const hide = vi.spyOn(context, 'hideContextMenu')
        const w = mountHeart()

        rightClick(heart(w))
        await flushPromises()

        expect(hide).toHaveBeenCalled()
    })

    it('opens nothing while no track is playing', async () => {
        const w = mountHeart({ trackhash: '' })

        rightClick(heart(w))
        await flushPromises()

        expect(picker()).toBeNull()
    })
})

describe('RatableHeart: rating', () => {
    it('rates the track with the picked star, through the store, and closes', async () => {
        const w = mountHeart({ rating: 2 })
        const rate = vi.spyOn(useRatings(), 'rate')

        rightClick(heart(w))
        await flushPromises()
        stars()[3].click()
        await flushPromises()

        expect(rate).toHaveBeenCalledWith(HASH, 4, 2)
        expect(setTrackRating).toHaveBeenCalledWith(HASH, 4)
        expect(picker()).toBeNull()
        // Published per hash: every other copy of this track reads 4 now.
        expect(useRatings().rating(HASH, null)).toBe(4)
    })

    it('clears the rating with "Remove rating"', async () => {
        const w = mountHeart({ rating: 3 })
        const rate = vi.spyOn(useRatings(), 'rate')

        rightClick(heart(w))
        await flushPromises()
        const remove = document.querySelector<HTMLButtonElement>('.heart-rating-picker .rating-clear')
        expect(remove?.textContent?.trim()).toBe('Remove rating')
        remove!.click()
        await flushPromises()

        expect(rate).toHaveBeenCalledWith(HASH, null, 3)
        expect(clearTrackRating).toHaveBeenCalledWith(HASH)
        expect(picker()).toBeNull()
        expect(useRatings().rating(HASH, 3)).toBeNull()
    })

    it('offers no "Remove rating" for an unrated track', async () => {
        const w = mountHeart()

        rightClick(heart(w))
        await flushPromises()

        expect(document.querySelector('.heart-rating-picker .rating-clear')).toBeNull()
    })

    it('rolls the optimistic rating back when the server refuses it', async () => {
        setTrackRating.mockResolvedValue(false)
        const w = mountHeart({ rating: 2 })

        rightClick(heart(w))
        await flushPromises()
        stars()[4].click()
        await flushPromises()

        expect(useRatings().rating(HASH, 2)).toBe(2)
    })

    // No mark on the heart (user: "ohne badge"); the rating shows in the
    // tooltip and in the stars it opens.
    it('names a rating made elsewhere (same hash) in its tooltip, with no mark on the heart', async () => {
        const w = mountHeart()

        useRatings().record(HASH, 5)
        await flushPromises()

        expect(heart(w).getAttribute('title')).toContain('Rated 5 of 5')
        // Nothing written on the heart itself: no number, no tag.
        expect(heart(w).textContent?.trim()).toBe('')

        rightClick(heart(w))
        await flushPromises()
        expect(stars()[4].getAttribute('aria-pressed')).toBe('true')
    })
})

describe('RatableHeart: closing', () => {
    it('closes on Escape and hands focus back to the heart', async () => {
        const w = mountHeart()

        rightClick(heart(w))
        await flushPromises()
        // Focus went into the stars, so the keyboard can rate straight away.
        expect(document.activeElement).toBe(stars()[0])

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        await flushPromises()

        expect(picker()).toBeNull()
        expect(document.activeElement).toBe(heart(w))
        expect(setTrackRating).not.toHaveBeenCalled()
    })

    it('closes on a press outside, and not on one inside the panel', async () => {
        const outside = document.createElement('div')
        document.body.appendChild(outside)
        const w = mountHeart()

        rightClick(heart(w))
        await flushPromises()

        stars()[1].dispatchEvent(new Event('pointerdown', { bubbles: true }))
        await flushPromises()
        expect(picker()).not.toBeNull()

        outside.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        await flushPromises()
        expect(picker()).toBeNull()
        expect(w.emitted('handleFav')).toBeUndefined()
    })

    it('closes when the track changes, so a star cannot rate the next song', async () => {
        const w = mountHeart()

        rightClick(heart(w))
        await flushPromises()
        await w.setProps({ trackhash: OTHER })
        await flushPromises()

        expect(picker()).toBeNull()
    })
})

// The keys the panel owns must not reach the player's shortcuts on `window`
// (helpers/useKeyboard.ts): an arrow skipped to the next song, Space paused.
describe('RatableHeart: the keyboard in the stars', () => {
    function shortcutSpy() {
        const seen: string[] = []
        const listener = (e: KeyboardEvent) => seen.push(e.key)
        window.addEventListener('keydown', listener)
        return { seen, stop: () => window.removeEventListener('keydown', listener) }
    }
    const key = (el: Element, k: string) =>
        el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))

    it('moves between the stars with the arrows, Home and End, and the player never sees them', async () => {
        const w = mountHeart()
        const spy = shortcutSpy()
        rightClick(heart(w))
        await flushPromises()
        expect(document.activeElement).toBe(stars()[0])

        key(stars()[0], 'ArrowRight')
        expect(document.activeElement).toBe(stars()[1])
        key(stars()[1], 'ArrowLeft')
        expect(document.activeElement).toBe(stars()[0])
        key(stars()[0], 'End')
        expect(document.activeElement).toBe(stars()[4])
        key(stars()[4], 'Home')
        expect(document.activeElement).toBe(stars()[0])

        expect(spy.seen).toEqual([])
        expect(picker()).not.toBeNull()
        spy.stop()
    })

    it('keeps Space and Enter from the player, but lets Escape through to close', async () => {
        const w = mountHeart()
        const spy = shortcutSpy()
        rightClick(heart(w))
        await flushPromises()

        key(stars()[2], ' ')
        key(stars()[2], 'Enter')
        expect(spy.seen).toEqual([])

        key(stars()[2], 'Escape')
        await flushPromises()
        expect(picker()).toBeNull()
        spy.stop()
    })

    it('hands focus back to the heart after a pick from the keyboard', async () => {
        const w = mountHeart()
        rightClick(heart(w))
        await flushPromises()

        stars()[3].focus()
        stars()[3].click()
        await flushPromises()

        expect(setTrackRating).toHaveBeenCalledWith(HASH, 4)
        expect(document.activeElement).toBe(heart(w))
    })

    it('closes when focus leaves the panel', async () => {
        const w = mountHeart()
        const outside = document.createElement('button')
        document.body.appendChild(outside)
        rightClick(heart(w))
        await flushPromises()

        outside.focus()
        await flushPromises()

        expect(picker()).toBeNull()
    })
})
