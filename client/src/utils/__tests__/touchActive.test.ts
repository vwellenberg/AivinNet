import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import { installTouchActive } from '@/utils/touchActive'

// ---------------------------------------------------------------------------
// The press is what a tap shows, now that the button roles hover only under a
// pointer — and Safari on iOS applies `:active` to a non-link only when the
// element or <body> listens for `touchstart`. Without the listener an iPhone
// would show no feedback at all on any button.
// ---------------------------------------------------------------------------

describe('installTouchActive', () => {
    it('registers a passive touchstart listener on <body>', () => {
        const spy = vi.spyOn(document.body, 'addEventListener')
        const uninstall = installTouchActive()

        expect(spy).toHaveBeenCalledWith('touchstart', expect.any(Function), { passive: true })
        // Passive is the point: a non-passive touch listener on <body> could
        // hold up every scroll in the app.
        const options = spy.mock.calls.find(([type]) => type === 'touchstart')?.[2]
        expect(options).toEqual({ passive: true })

        uninstall()
        spy.mockRestore()
    })

    it('does nothing to the touch it hears', () => {
        const uninstall = installTouchActive()
        const touch = new Event('touchstart', { bubbles: true, cancelable: true })
        document.body.dispatchEvent(touch)
        expect(touch.defaultPrevented).toBe(false)
        uninstall()
    })

    it('is installed when the app starts', () => {
        // A unit test of the helper proves nothing if nobody calls it.
        const main = readFileSync('src/main.ts', 'utf8')
            .split('\n')
            .filter(line => !/^\s*(import|\/\/)/.test(line))
            .join('\n')
        expect(main).toMatch(/installTouchActive\s*\(\s*\)/)
    })
})
