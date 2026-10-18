import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { holdPeek, peeking } from '../settingsPeek'

describe('holdPeek', () => {
    let el: HTMLInputElement
    let release: () => void

    beforeEach(() => {
        peeking.value = false
        el = document.createElement('input')
        document.body.appendChild(el)
        release = holdPeek(el)
    })

    afterEach(() => {
        release()
        el.remove()
    })

    it('peeks while the pointer is down and stops when it is released', () => {
        el.dispatchEvent(new Event('pointerdown'))
        expect(peeking.value).toBe(true)

        window.dispatchEvent(new Event('pointerup'))
        expect(peeking.value).toBe(false)
    })

    it('ends the peek when the drag finishes OUTSIDE the slider', () => {
        // The release is heard on window: a pointerup that only the slider
        // listened for would leave the modal invisible after a long drag.
        el.dispatchEvent(new Event('pointerdown'))
        document.body.dispatchEvent(new Event('pointerup', { bubbles: true }))

        expect(peeking.value).toBe(false)
    })

    it('ends the peek when the browser cancels the gesture', () => {
        el.dispatchEvent(new Event('pointerdown'))
        window.dispatchEvent(new Event('pointercancel'))

        expect(peeking.value).toBe(false)
    })

    it('peeks on a keyboard adjustment and stops on key up', () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }))
        expect(peeking.value).toBe(true)

        el.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight' }))
        expect(peeking.value).toBe(false)
    })

    it('ignores keys that do not change the value', () => {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
        expect(peeking.value).toBe(false)
    })

    it('releases on blur and on cleanup', () => {
        el.dispatchEvent(new Event('pointerdown'))
        el.dispatchEvent(new Event('blur'))
        expect(peeking.value).toBe(false)

        el.dispatchEvent(new Event('pointerdown'))
        release()
        expect(peeking.value).toBe(false)

        // After cleanup the element no longer starts a peek.
        el.dispatchEvent(new Event('pointerdown'))
        expect(peeking.value).toBe(false)
    })
})
