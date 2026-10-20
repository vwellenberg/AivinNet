import { readFileSync } from 'node:fs'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
    ARRIVAL_ANIMATION,
    ARRIVAL_ANIMATIONS,
    ARRIVED_ATTR,
    NOW_PLAYING_ANIMATIONS,
    NOW_PLAYING_ARRIVED_ATTR,
    NOW_PLAYING_CLASS,
    SCROLLER_VIEW,
    STARTED_ATTR,
    installArrivalLatch,
} from '@/utils/arrivalLatch'

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

function animationStart(target: Element, animationName: string, pseudoElement = '') {
    const e = new Event('animationstart', { bubbles: true })
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

    it('latches the Continue card too, which Home reorders under it', () => {
        // A keyed `v-for` item: a refetch with a new order moves its node, and
        // the move restarts its rise — the same restart the scroller causes.
        const card = document.createElement('div')
        document.body.appendChild(card)
        animationStart(card, 'mem-plate-rise')
        animationStart(card, 'mem-plate-rise')
        expect(card.hasAttribute(ARRIVED_ATTR)).toBe(true)
    })

    it('ignores every other animation', () => {
        animationEnd(row, 'mem-band-drop')
        animationEnd(row, 'fav-shard-fly') // a click effect, not an arrival
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

    it('latches a row whose entrance is RESTARTED before it has ended', () => {
        // Scroll down, then fast to the top: the new rows are still mid-entrance
        // when the scroller re-sorts them (~300 ms later) and the move restarts
        // the animation. No `animationend` has happened yet — the second START
        // is the only sign, and it must latch (the entrance played twice).
        animationStart(row, ARRIVAL_ANIMATION)
        expect(row.hasAttribute(STARTED_ATTR)).toBe(true)
        expect(row.hasAttribute(ARRIVED_ATTR), 'the first start is the entrance itself').toBe(false)

        animationStart(row, ARRIVAL_ANIMATION)
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(true)
    })

    it("latches a detail head's button pop and its sticker when the re-sort restarts them", () => {
        // The album head's four buttons and its caption sticker popped in twice
        // on the way back up: the scroller moved the view they sit in.
        const view = document.createElement('div')
        view.className = 'vue-recycle-scroller__item-view'
        document.body.appendChild(view)
        for (const name of ['btn-pop', 'mem-sticker-slap', 'mem-motif-pop']) {
            const el = document.createElement('button')
            view.appendChild(el)
            animationStart(el, name)
            expect(el.hasAttribute(ARRIVED_ATTR), `${name}: the first start is the arrival`).toBe(false)
            animationStart(el, name)
            expect(el.hasAttribute(ARRIVED_ATTR), name).toBe(true)
        }
    })

    it('leaves buttons and stickers outside a scroller view alone', () => {
        // Nothing moves them there, and shuffle/repeat pop again on purpose
        // each time they are switched on.
        const toggle = document.createElement('button')
        document.body.appendChild(toggle)
        animationStart(toggle, 'btn-pop')
        animationStart(toggle, 'btn-pop')
        animationEnd(toggle, 'mem-sticker-slap')
        expect(toggle.hasAttribute(STARTED_ATTR)).toBe(false)
        expect(toggle.hasAttribute(ARRIVED_ATTR)).toBe(false)
    })

    it('does not count pseudo-elements or other animations as a restart', () => {
        animationStart(row, ARRIVAL_ANIMATION)
        animationStart(row, ARRIVAL_ANIMATION, '::after')
        animationStart(row, 'mem-band-drop')
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)
    })

    it('stops listening when uninstalled', () => {
        uninstall()
        animationEnd(row, ARRIVAL_ANIMATION)
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)
        uninstall = () => {}
    })
})

// ---------------------------------------------------------------------------
// The playing row rings its state in on its pseudo-elements (band drop on
// ::after, texture wipe on ::before), and the scroller's re-sort restarted them
// just like the entrance: scrolling up the queue, the playing row built up,
// then built up again ~580 ms later. Unlike the entrance, it must come back
// when the same node becomes the playing row again.
// ---------------------------------------------------------------------------

/** The MutationObserver reports a microtask after the class change. */
const observed = () => new Promise(resolve => setTimeout(resolve))

/** A row entering the playing state: both ornaments start in the same frame. */
function ringIn(target: Element) {
    animationStart(target, 'mem-texture-wipe', '::before')
    animationStart(target, 'mem-band-drop', '::after')
}

describe('now-playing latch', () => {
    beforeEach(() => row.classList.add(NOW_PLAYING_CLASS))

    it('latches the row once its ornament has played', () => {
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR), 'not while it plays').toBe(false)
        animationEnd(row, 'mem-band-drop', '::after')
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(true)
    })

    it('latches an ornament the re-sort restarts before it has ended', () => {
        ringIn(row)
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(true)
    })

    it('does not take the second pseudo-element of the same start for a restart', () => {
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(false)
    })

    it('leaves the entrance latch alone, and the entrance leaves this one alone', () => {
        ringIn(row)
        animationEnd(row, 'mem-band-drop', '::after')
        expect(row.hasAttribute(ARRIVED_ATTR)).toBe(false)

        const other = document.createElement('div')
        other.className = `songlist-item ${NOW_PLAYING_CLASS}`
        document.body.appendChild(other)
        animationStart(other, ARRIVAL_ANIMATION)
        animationStart(other, ARRIVAL_ANIMATION)
        animationEnd(other, 'mem-band-drop') // not on a pseudo-element
        expect(other.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(false)
    })

    it('stays latched through class rewrites that keep the state', async () => {
        // A recycled row swaps its band class all the time.
        ringIn(row)
        animationEnd(row, 'mem-band-drop', '::after')
        row.className = `songlist-item band-1 is-last ${NOW_PLAYING_CLASS}`
        await observed()
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(true)
    })

    it('is released when the row leaves the state, so it rings in again next time', async () => {
        // The next track, or the node recycled onto a track that is not playing.
        ringIn(row)
        animationEnd(row, 'mem-band-drop', '::after')
        row.classList.remove(NOW_PLAYING_CLASS)
        await observed()
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(false)

        row.classList.add(NOW_PLAYING_CLASS)
        await observed()
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR), 'a new state, not a restart').toBe(false)
    })

    it('forgets a start that never ended when the row leaves the state', async () => {
        // Recycled mid-animation: no animationend, no latch — the record of
        // the start must go all the same, or the next ring-in counts as a restart.
        ringIn(row)
        row.classList.remove(NOW_PLAYING_CLASS)
        await observed()
        row.classList.add(NOW_PLAYING_CLASS)
        await observed()
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(false)
    })

    it('does not let an event that arrives after the row left the state latch it again', async () => {
        // The frame the ring-in ends in can be the frame the row is recycled:
        // the observer has released it, then `animationend` still comes in.
        ringIn(row)
        row.classList.remove(NOW_PLAYING_CLASS)
        await observed()
        animationEnd(row, 'mem-band-drop', '::after')
        ringIn(row) // a late start, too
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR)).toBe(false)

        row.classList.add(NOW_PLAYING_CLASS)
        await observed()
        ringIn(row)
        expect(row.hasAttribute(NOW_PLAYING_ARRIVED_ATTR), 'the next ring-in still plays').toBe(false)
    })
})

describe('the two halves agree', () => {
    it('latches the keyframes the arrival actually runs', () => {
        const classes = readFileSync('src/assets/scss/Global/_button-classes.scss', 'utf8')
        for (const name of ARRIVAL_ANIMATIONS) expect(classes).toContain(`@keyframes ${name}`)
    })

    it('switches the arrival off for latched elements, inside the shared mixin', () => {
        // In the mixin, not per call site: every `mem-arrival` user — rows,
        // tiles, the next one — gets the latch without knowing about it.
        const candy = readFileSync('src/assets/scss/_candy.scss', 'utf8')
        const mixin = candy.slice(candy.indexOf('@mixin mem-arrival'))
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        expect(body).toMatch(new RegExp(`&\\[${ARRIVED_ATTR}\\]\\s*\\{\\s*animation: none;`))
    })

    it.each([
        ['src/assets/scss/Global/_buttons.scss', '@mixin btn-pop', 'btn-pop'],
        ['src/assets/scss/_candy.scss', '@mixin mem-sticker', 'mem-sticker-slap'],
        ['src/assets/scss/_candy.scss', '@mixin mem-motif-pop', 'mem-motif-pop'],
    ])('%s: %s switches its arrival off once latched, inside a scroller view', (file, head, name) => {
        // Inside a scroller VIEW only: `btn-toggle-on` pops on purpose each time
        // shuffle or repeat is switched on, and nothing moves those nodes.
        expect(ARRIVAL_ANIMATIONS.has(name)).toBe(true)
        const source = readFileSync(file, 'utf8')
        const at = source.search(new RegExp(`${head}\\b`))
        expect(at, `${head} not found in ${file}`).toBeGreaterThanOrEqual(0)
        const body = source.slice(at, at + source.slice(at).search(/^}/m) + 1)

        expect(body, `${head} not found`).toContain(`animation: ${name} `)
        expect(body).toMatch(
            new RegExp(`\\${SCROLLER_VIEW} &\\[${ARRIVED_ATTR}\\]\\s*\\{\\s*animation: none;`)
        )
    })

    it("latches the keyframes the playing row runs, and switches them off inside its mixin", () => {
        const classes = readFileSync('src/assets/scss/Global/_button-classes.scss', 'utf8')
        const candy = readFileSync('src/assets/scss/_candy.scss', 'utf8')
        const mixin = candy.slice(candy.indexOf('@mixin mem-now-playing-row'))
        const body = mixin.slice(0, mixin.search(/^}/m) + 1)

        const run = [...body.matchAll(/animation:\s*(mem-[\w-]+)/g)].map(m => m[1])
        expect(run.length, 'the mixin rings the state in').toBeGreaterThan(0)
        expect(new Set(run)).toEqual(NOW_PLAYING_ANIMATIONS)
        for (const name of NOW_PLAYING_ANIMATIONS) expect(classes).toContain(`@keyframes ${name}`)

        expect(body).toMatch(
            new RegExp(
                `&\\[${NOW_PLAYING_ARRIVED_ATTR}\\]::before,\\s*&\\[${NOW_PLAYING_ARRIVED_ATTR}\\]::after\\s*\\{\\s*animation: none;`
            )
        )
    })

    it('is installed for the app', () => {
        const main = readFileSync('src/main.ts', 'utf8')
        expect(main).toMatch(/^installArrivalLatch\(\);?$/m)
    })
})
