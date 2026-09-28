import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { ARRIVAL_ANIMATION, ARRIVED_ATTR, installArrivalLatch } from '@/utils/arrivalLatch'

// ---------------------------------------------------------------------------
// The arrival plays once per element. A CSS animation restarts whenever its
// node is re-inserted, and the virtual scrollers re-insert their rows ~300 ms
// after every scroll (`sortViews`): 70 rows of a playlist re-ran their
// entrance after the scrolling had stopped — "it builds up and then flickers
// once more". The latch marks an element when its entrance has ended, and the
// stylesheet switches the animation off for marked elements.
// ---------------------------------------------------------------------------

/** jsdom has no AnimationEvent — an Event carrying the same fields will do. */
function animationEnd(target: Element, animationName: string, pseudoElement = '') {
    const e = new Event('animationend', { bubbles: true })
    Object.defineProperty(e, 'animationName', { value: animationName })
    Object.defineProperty(e, 'pseudoElement', { value: pseudoElement })
    target.dispatchEvent(e)
}

let row: HTMLElement
let uninstall: () => void

beforeEach(() => {
    row = document.createElement('div')
    row.className = 'songlist-item'
    document.body.appendChild(row)
    uninstall = installArrivalLatch(document)
})

afterEach(() => {
    uninstall()
    document.body.innerHTML = ''
})

describe('arrival latch', () => {
    it('marks an element once its entrance has played', () => {
        animationEnd(row, ARRIVAL_ANIMATION)
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(true)
    })

    it("ignores the row's pseudo-elements, which report the row as their target", () => {
        // The now-playing row's band drop and texture wipe run on ::after and
        // ::before. Even under the arrival's name they are not the row arriving.
        animationEnd(row, ARRIVAL_ANIMATION, '::after')
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)
    })

    it('ignores every other animation', () => {
        animationEnd(row, 'mem-band-drop')
        animationEnd(row, 'btn-pop')
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)
    })

    it('survives the class rewrites a recycled row goes through', () => {
        // Vue rewrites `class` whenever a bound class changes — a recycled row
        // swaps its band class on every recycle. A class as the marker would be
        // wiped and the entrance would come back; an unbound attribute is not.
        animationEnd(row, ARRIVAL_ANIMATION)
        row.className = 'songlist-item band-1 is-last'
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(true)
    })

    it('stops listening when uninstalled', () => {
        uninstall()
        animationEnd(row, ARRIVAL_ANIMATION)
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)
        uninstall = () => {}
    })
})

describe('the two halves agree', () => {
    it('latches the keyframes the arrival actually runs', () => {
        const classes = readFileSync('src/assets/scss/Global/_button-classes.scss', 'utf8')
        expect(classes).toContain(`@keyframes ${ARRIVAL_ANIMATION}`)
    })

    it('switches the arrival off for latched elements, inside the shared mixin', () => {
        // In the mixin, not per call site: every `mem-arrival` user — rows,
        // tiles, the next one — gets the latch without knowing about it.
        const candy = readFileSync('src/assets/scss/_candy.scss', 'utf8')
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        expect(body).toMatch(new RegExp(`&\\[${ARRIVED_ATTR}\\]\\s*\\{\\s*animation: none;`))
    })

    it('is installed for the app', () => {
        const main = readFileSync('src/main.ts', 'utf8')
        expect(main).toMatch(/^installArrivalLatch\(\);?$/m)
    })
})
