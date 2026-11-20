import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createScrollMemory } from '../scrollMemory'

// Back from an album landed at the top of Home: Home scrolls in its own
// element, which is built anew on every visit, so nothing kept the place.

describe('createScrollMemory', () => {
    it('brings the place back on a return to the same entry', () => {
        const memory = createScrollMemory()
        // A fresh visit (no forward yet), scrolled down, then on to an album.
        expect(memory.enter({ position: 3, forward: null })).toBe(0)
        memory.keep({ position: 3 }, 1840)

        // Back: Vue Router set `forward` on the entry when it pushed the album.
        expect(memory.enter({ position: 3, forward: '/albums/abc' })).toBe(1840)
    })

    it('starts at the top on a fresh visit, and forgets what an older entry kept there', () => {
        const memory = createScrollMemory()
        memory.keep({ position: 2 }, 900)

        // A click on "Home" pushes a new entry, which can reuse the number.
        expect(memory.enter({ position: 2, forward: null })).toBe(0)
        expect(memory.enter({ position: 2, forward: '/albums/abc' })).toBe(0)
    })

    it('keeps each entry apart', () => {
        const memory = createScrollMemory()
        memory.keep({ position: 1 }, 100)
        memory.keep({ position: 4 }, 400)

        expect(memory.enter({ position: 1, forward: '/x' })).toBe(100)
        expect(memory.enter({ position: 4, forward: '/y' })).toBe(400)
    })

    it('does nothing without a history entry of the router', () => {
        const memory = createScrollMemory()
        memory.keep(null, 500)

        expect(memory.enter(null)).toBe(0)
        expect(memory.enter({ forward: '/x' })).toBe(0)
    })
})

describe('Home uses it', () => {
    const home = readFileSync('src/views/HomeView/main.vue', 'utf8').replace(/^import .*$/gm, '')

    it('keeps its place while scrolling and restores it on mount', () => {
        expect(home).toMatch(/class="homepageview[^"]*"[\s\S]*?@scroll\.passive="keepPlace"/)
        expect(home).toMatch(/homeScroll\.keep\(historyEntry,/)
        expect(home).toMatch(/scrollWhenReady\(page\.value, homeScroll\.enter\(historyEntry\)\)/)
    })
})
