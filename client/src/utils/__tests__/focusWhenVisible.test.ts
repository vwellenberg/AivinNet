import { describe, expect, it } from 'vitest'

import { focusWhenVisible } from '../focusWhenVisible'

// The wait is for the CONDITION focus needs, not for a number of frames: under
// the reduced-motion policy an inherited `visibility` reached the menu items a
// frame per nesting level late, and a fixed wait focused a still-hidden item.

describe('focusWhenVisible', () => {
    it('focuses at once when the element is already visible', async () => {
        const button = document.createElement('button')
        document.body.appendChild(button)

        expect(await focusWhenVisible(button)).toBe(true)
        expect(document.activeElement).toBe(button)
    })

    it('waits while the element is hidden, and focuses once it is shown', async () => {
        const host = document.createElement('div')
        host.style.visibility = 'hidden'
        const button = document.createElement('button')
        host.appendChild(button)
        document.body.appendChild(host)

        const pending = focusWhenVisible(button)
        await new Promise(resolve => setTimeout(resolve, 40))
        expect(document.activeElement).not.toBe(button)

        host.style.visibility = 'visible'
        expect(await pending).toBe(true)
        expect(document.activeElement).toBe(button)
    })

    it('gives up rather than wait forever, and says so', async () => {
        const host = document.createElement('div')
        host.style.visibility = 'hidden'
        const button = document.createElement('button')
        host.appendChild(button)
        document.body.appendChild(host)

        expect(await focusWhenVisible(button, 3)).toBe(false)
    })

    it('does nothing for no element', async () => {
        expect(await focusWhenVisible(null)).toBe(false)
    })
})
