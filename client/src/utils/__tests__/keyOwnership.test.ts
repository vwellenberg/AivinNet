import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { __resetFocusOrigin, controlOwnsKey, focusCameFromKeyboard, trackFocusOrigin } from '../keyOwnership'

// ---------------------------------------------------------------------------
// Space belonged to the global play/pause shortcut everywhere but text fields,
// and the shortcut called preventDefault() — which cancels a button's own
// activation. On the running build, Space on a focused button clicked nothing
// and started playback instead (#137). These pin the rule that replaced it.
//
// `:focus-visible` itself is the browser's to decide and jsdom does not know
// the selector, so the keyboard-focus bit is passed in; the real browser run
// that found the bug is in the PR.
// ---------------------------------------------------------------------------

function el(html: string): Element {
    const host = document.createElement('div')
    host.innerHTML = html
    return host.firstElementChild as Element
}

describe('a control the keyboard has landed on', () => {
    it.each([
        ['<button>Go</button>', 'a button'],
        ['<a href="#/x">Go</a>', 'a link'],
        ['<div role="button" tabindex="0">Folder</div>', 'a composed button (the sidebar folder header)'],
        ['<div role="menuitem" tabindex="-1">Play next</div>', 'a menu item'],
        ['<div role="switch" tabindex="0"></div>', 'a switch'],
    ])('keeps Space for %s', html => {
        expect(controlOwnsKey(el(html), ' ', true)).toBe(true)
    })

    it('keeps Enter as well', () => {
        expect(controlOwnsKey(el('<button>Go</button>'), 'Enter', true)).toBe(true)
    })

    it('counts a focusable element INSIDE a control', () => {
        const button = el('<button><span tabindex="-1">x</span></button>')
        expect(controlOwnsKey(button.querySelector('span'), ' ', true)).toBe(true)
    })
})

describe('the global shortcut keeps', () => {
    it('Space after a MOUSE click left focus on a button', () => {
        // Whoever clicks something and then reaches for Space still means
        // "play/pause". Mouse focus is not keyboard focus.
        expect(controlOwnsKey(el('<button>Go</button>'), ' ', false)).toBe(false)
    })

    it('Space on the page itself', () => {
        expect(controlOwnsKey(document.body, ' ', true)).toBe(false)
    })

    it('Space on something that is not a control', () => {
        expect(controlOwnsKey(el('<div tabindex="0">plain</div>'), ' ', true)).toBe(false)
        expect(controlOwnsKey(el('<div role="presentation" tabindex="0"></div>'), ' ', true)).toBe(false)
    })

    it('every other key, even on a control', () => {
        // The letter shortcuts are not a button's to answer.
        expect(controlOwnsKey(el('<button>Go</button>'), 'k', true)).toBe(false)
        expect(controlOwnsKey(el('<button>Go</button>'), 'ArrowRight', true)).toBe(false)
    })

    it('nothing when there is no target', () => {
        expect(controlOwnsKey(null, ' ', true)).toBe(false)
    })
})

// ---------------------------------------------------------------------------
// Where focus came from. The first version asked `:focus-visible` instead, and
// Chrome turns that ON as soon as a key is pressed on the focused element — so
// after a mouse click it was true at keydown, and the click-then-Space habit
// stopped playing music (measured: master 1 play/pause, that version 0).
// ---------------------------------------------------------------------------

describe('where focus came from', () => {
    let button: HTMLButtonElement

    beforeAll(() => trackFocusOrigin(document))

    beforeEach(() => {
        __resetFocusOrigin()
        button = document.createElement('button')
        document.body.appendChild(button)
    })

    it('is the keyboard when nothing was pressed first (Tab, code)', () => {
        button.focus()
        expect(focusCameFromKeyboard()).toBe(true)
    })

    it('is the pointer right after a press — the click-then-Space habit', () => {
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        button.focus()
        expect(focusCameFromKeyboard()).toBe(false)
    })

    it('is the keyboard again once focus moves on without a press', () => {
        button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
        button.focus()
        const next = document.createElement('button')
        document.body.appendChild(next)
        // Tab, a second later: no pointer press anywhere near it.
        __resetFocusOrigin()
        next.focus()
        expect(focusCameFromKeyboard()).toBe(true)
    })
})
