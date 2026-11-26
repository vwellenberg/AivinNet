import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { pageEnters } from '@/utils/pageEnter'

// The page enters on a page change and holds still on a switch between
// entities of the same page (playlist to playlist), where the route name stays.

describe('pageEnters', () => {
    it('enters when the page changes', () => {
        expect(pageEnters({ name: 'albums' }, { name: 'playlists' })).toBe(true)
    })

    it('holds still when only the entity changes on the same page', () => {
        expect(pageEnters({ name: 'playlist' }, { name: 'playlist' })).toBe(false)
        expect(pageEnters({ name: 'album' }, { name: 'album' })).toBe(false)
    })

    it('enters on the first navigation, from the start location that has no name', () => {
        expect(pageEnters({ name: 'home' }, {})).toBe(true)
    })
})

// The ground (#acontent's own background) never moves on a navigation: it
// drifted against the entrance and read as the whole background wobbling.
describe('the page ground holds still', () => {
    const CSS = readFileSync('src/assets/scss/Global/_button-classes.scss', 'utf-8')

    // Keyframes that may move a background layer, each with its reason. The
    // guard used to forbid `background-position` anywhere in the file, which
    // also caught a layer that is not the ground.
    const MOVES_A_LAYER: Record<string, string> = {
        'mem-marker-in': "the active nav entry's zigzag layer slides in from under its frame (mem-row-marker)",
    }

    it('has no drift keyframes and no animation on #acontent itself', () => {
        expect(CSS).not.toMatch(/mem-ground-drift/)
        const code = CSS.replace(/\/\/[^\n]*/g, '')
        const moving = [...code.matchAll(/@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g)]
            .filter(([, , body]) => /background-position/.test(body))
            .map(([, name]) => name)
        // Guard over the parser: the one known mover is found.
        expect(moving).toContain('mem-marker-in')
        expect(moving.filter((name) => !(name in MOVES_A_LAYER))).toEqual([])
        // Outside keyframes, nothing here sets a background position at all.
        const outside = code.replace(/@keyframes\s+[\w-]+\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '')
        expect(outside).not.toMatch(/background-position/)
        // Only the CHILDREN of #acontent animate on a page change.
        expect(CSS).not.toMatch(/#acontent\.page-enter\s*\{/)
        expect(CSS).toMatch(/#acontent\.page-enter > \*:not\(#contentresizer\) \{\s*animation: mem-page-enter/)
    })

    it('the router still sets the class that plays the entrance', () => {
        const ROUTER = readFileSync('src/router/index.ts', 'utf-8')
        expect(ROUTER).toContain("content.classList.add('page-enter')")
        expect(ROUTER).toContain('pageEnters(to, from)')
    })
})
