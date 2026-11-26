import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// menu-label-fit.js opened only 6 of its 8 menus on every deploy and still said
// OK (2026-11-26). The list pages run through vue-virtual-scroller, which parks
// its unused card views far off the page (the first `.album-card` in the DOM
// measured top = -999878 px), and `locator(".album-card").first()` picked one
// of those: a click that waits 15 s and gives up. scripts/onscreen.js picks the
// first card whose centre is on screen; these tests hold that rule, and that
// the gate uses it and no longer passes a partial run.
// ---------------------------------------------------------------------------

const require = createRequire(import.meta.url)
const { firstOnScreen } = require('../onscreen.js') as {
    firstOnScreen: (selector: string, env: FakeEnv) => boolean
}

type Box = { left: number; top: number; width: number; height: number }
type FakeEnv = { document: FakeDocument; innerWidth: number; innerHeight: number }
type FakeDocument = { querySelectorAll: (selector: string) => FakeElement[] }

class FakeElement {
    attrs = new Set<string>()
    constructor(
        public name: string,
        private box: Box,
    ) {}
    getBoundingClientRect() {
        return this.box
    }
    setAttribute(attr: string) {
        this.attrs.add(attr)
    }
    removeAttribute(attr: string) {
        this.attrs.delete(attr)
    }
}

function page(cards: FakeElement[]): FakeEnv {
    return {
        innerWidth: 1440,
        innerHeight: 950,
        document: {
            querySelectorAll: (selector: string) =>
                selector === '[data-gate-target]' ? cards.filter(c => c.attrs.has('data-gate-target')) : cards,
        },
    }
}

const card = (name: string, top: number, left = 303) => new FakeElement(name, { left, top, width: 192, height: 336 })
const tagged = (cards: FakeElement[]) => cards.filter(c => c.attrs.has('data-gate-target')).map(c => c.name)

describe('firstOnScreen', () => {
    it('skips a pooled view parked off the page, as the virtual scroller leaves them', () => {
        const cards = [card('parked', -999878), card('visible', 281)]
        expect(firstOnScreen('.album-card', page(cards))).toBe(true)
        expect(tagged(cards)).toEqual(['visible'])
    })

    it('prefers a card on screen to one below the fold, and skips one with no size', () => {
        const cards = [card('below', 2000), new FakeElement('collapsed', { left: 0, top: 10, width: 0, height: 0 }), card('on screen', 600)]
        firstOnScreen('.album-card', page(cards))
        expect(tagged(cards)).toEqual(['on screen'])
    })

    it('takes one below the fold when none is on screen: Playwright scrolls to it', () => {
        // The track rows on /favorites start under the album row.
        const cards = [card('parked', -999878), card('below', 1400)]
        expect(firstOnScreen('.songlist-item', page(cards))).toBe(true)
        expect(tagged(cards)).toEqual(['below'])
    })

    it('never takes one above the page: the gates load each route at the top', () => {
        const cards = [card('parked', -999878), card('parked too', -9999)]
        expect(firstOnScreen('.album-card', page(cards))).toBe(false)
        expect(tagged(cards)).toEqual([])
    })

    it('tags exactly one element, and moves the tag on the next call', () => {
        const first = card('first', 100)
        const second = card('second', 500)
        const env = page([first, second])
        firstOnScreen('.album-card', env)
        expect(tagged([first, second])).toEqual(['first'])

        first.getBoundingClientRect = () => ({ left: 303, top: -999878, width: 192, height: 336 })
        firstOnScreen('.album-card', env)
        expect(tagged([first, second])).toEqual(['second'])
    })
})

describe('menu-label-fit.js', () => {
    // Run from client/, as settle.test.ts reads the gates.
    const gate = readFileSync('scripts/menu-label-fit.js', 'utf8')

    it('clicks through onScreen, never the first match in the DOM', () => {
        expect(gate).toMatch(/require\("\.\/onscreen"\)/)
        expect(gate).not.toMatch(/\.first\(\)\.click/)
        expect(gate.match(/await onScreen\(page, target\.(enter|open)\)/g)).toHaveLength(2)
    })

    it('does not exit 0 when a menu could not be opened', () => {
        expect(gate).toMatch(/if \(opened < TARGETS\.length\) \{[\s\S]*?process\.exit\(2\)/)
    })
})
