import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
    COVER_MORPH_NAME,
    __resetCoverMorphForTests,
    armCoverMorph,
    beginCoverMorph,
    finishCoverMorph,
} from '@/utils/coverMorph'

// ---------------------------------------------------------------------------
// The morph is three steps across the router: a click arms it (capture phase,
// before the link navigates), `beforeEach` freezes the old state, `afterEach`
// names the header cover and releases the new state. jsdom has neither the
// View Transitions API nor matchMedia, so both are stubbed here — the browser
// behaviour itself is measured headless (see client/docs/verification.md).
// ---------------------------------------------------------------------------

function click(init: MouseEventInit = {}) {
    return new MouseEvent('click', { button: 0, bubbles: true, ...init })
}

let card: HTMLImageElement
let transitionUpdates: Array<() => Promise<void>>
let finishTransition: () => void
let reduceMotion: boolean

function mockViewTransitions() {
    ;(document as any).startViewTransition = vi.fn((update: () => Promise<void>) => {
        transitionUpdates.push(update)
        return {
            finished: new Promise<void>(resolve => {
                finishTransition = resolve
            }),
        }
    })
}

beforeEach(() => {
    __resetCoverMorphForTests()
    document.body.innerHTML = `
        <img class="card" />
        <div id="album-scroller"><div class="dh-art"><img /></div></div>
    `
    card = document.querySelector('.card') as HTMLImageElement
    transitionUpdates = []
    reduceMotion = false
    window.matchMedia = vi.fn(() => ({ matches: reduceMotion })) as any
    mockViewTransitions()
})

afterEach(() => {
    delete (document as any).startViewTransition
    vi.restoreAllMocks()
})

describe('coverMorph', () => {
    it('does nothing when no album card was clicked', () => {
        beginCoverMorph(true)

        expect((document as any).startViewTransition).not.toHaveBeenCalled()
        expect(card.style.viewTransitionName).toBe('')
    })

    it('a click on an album card freezes the old state and names the card cover', () => {
        armCoverMorph(card, click())
        beginCoverMorph(true)

        expect((document as any).startViewTransition).toHaveBeenCalledTimes(1)
        expect(card.style.viewTransitionName).toBe(COVER_MORPH_NAME)
    })

    it('a navigation to another route consumes the click without a morph', () => {
        armCoverMorph(card, click())
        beginCoverMorph(false)
        beginCoverMorph(true)

        expect((document as any).startViewTransition).not.toHaveBeenCalled()
    })

    it('modifier clicks and non-primary buttons open a new tab and do not arm', () => {
        armCoverMorph(card, click({ ctrlKey: true }))
        armCoverMorph(card, click({ metaKey: true }))
        armCoverMorph(card, click({ button: 1 }))
        beginCoverMorph(true)

        expect((document as any).startViewTransition).not.toHaveBeenCalled()
    })

    it('a click from long before the navigation is not the navigation\'s cause', () => {
        // Built before the spy: jsdom stamps every Event with Date.now() itself.
        const stale = click()
        vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(10_000)
        armCoverMorph(card, stale)
        beginCoverMorph(true)

        expect((document as any).startViewTransition).not.toHaveBeenCalled()
    })

    it('reduced motion never starts a transition', () => {
        reduceMotion = true
        armCoverMorph(card, click())
        beginCoverMorph(true)

        expect((document as any).startViewTransition).not.toHaveBeenCalled()
        expect(card.style.viewTransitionName).toBe('')
    })

    it('without the API the click just navigates', () => {
        delete (document as any).startViewTransition
        armCoverMorph(card, click())

        expect(() => beginCoverMorph(true)).not.toThrow()
        expect(card.style.viewTransitionName).toBe('')
    })

    it('the new state waits for the header cover, then names it and is released', async () => {
        const header = document.querySelector('#album-scroller .dh-art img') as HTMLImageElement
        armCoverMorph(card, click())
        beginCoverMorph(true)

        let released = false
        const newState = transitionUpdates[0]()
        newState.then(() => {
            released = true
        })
        await Promise.resolve()
        expect(released).toBe(false)

        await finishCoverMorph()
        await newState
        expect(released).toBe(true)
        expect(header.style.viewTransitionName).toBe(COVER_MORPH_NAME)
    })

    it('without a header the new state is still released, so the browser can finish', async () => {
        document.getElementById('album-scroller')?.remove()
        armCoverMorph(card, click())
        beginCoverMorph(true)

        const newState = transitionUpdates[0]()
        await finishCoverMorph()

        await expect(newState).resolves.toBeUndefined()
    })

    it('the names are removed once the transition has finished', async () => {
        const header = document.querySelector('#album-scroller .dh-art img') as HTMLImageElement
        armCoverMorph(card, click())
        beginCoverMorph(true)
        const newState = transitionUpdates[0]()
        await finishCoverMorph()
        await newState

        finishTransition()
        await new Promise(resolve => setTimeout(resolve, 0))

        expect(card.style.viewTransitionName).toBe('')
        expect(header.style.viewTransitionName).toBe('')
    })

    it('a second morph releases the first one instead of leaving it hanging', async () => {
        armCoverMorph(card, click())
        beginCoverMorph(true)
        const first = transitionUpdates[0]()

        armCoverMorph(card, click())
        beginCoverMorph(true)

        await expect(first).resolves.toBeUndefined()
    })
})
