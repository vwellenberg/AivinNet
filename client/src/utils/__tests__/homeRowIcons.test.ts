import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { rowIcon } from '@/utils/homeRowIcons'

// The row keys Home can send, from the server's default order
// (src/aivinnet/lib/home/layout.py::DEFAULT_ORDER) — read from the source, so a
// new row without a glyph turns this red instead of standing bare on Home.
const LAYOUT = readFileSync('../src/aivinnet/lib/home/layout.py', 'utf-8')
const ORDER = LAYOUT.slice(LAYOUT.indexOf('DEFAULT_ORDER'), LAYOUT.indexOf(')', LAYOUT.indexOf('DEFAULT_ORDER')))
const KEYS = [...ORDER.matchAll(/"([a-z_]+)"/g)].map(m => m[1])

describe('the glyph before a Home row caption', () => {
    it('reads the server order', () => {
        expect(KEYS).toContain('your_mixes')
        expect(KEYS).toContain('recently_added')
    })

    // "Continue listening" is drawn as cards without a caption.
    it.each(KEYS.filter(k => k !== 'continue_listening'))('row %s has one', key => {
        expect(rowIcon({ key, title: 'Your weekday evenings' })).toBeDefined()
    })

    it('gives every row its own glyph', () => {
        const rows = KEYS.filter(k => k !== 'continue_listening' && k !== 'for_this_time')
        const glyphs = rows.map(key => rowIcon({ key }))
        expect(new Set(glyphs).size).toBe(rows.length)
    })

    it('follows the time band of "Your weekday evenings", not its key', () => {
        const night = rowIcon({ key: 'for_this_time', title: 'Your weekday nights' })
        expect(rowIcon({ key: 'for_this_time', title: 'Your weekend evenings' })).toBe(night)
        const day = rowIcon({ key: 'for_this_time', title: 'Your weekday mornings' })
        expect(rowIcon({ key: 'for_this_time', title: 'Your weekend afternoons' })).toBe(day)
        expect(day).not.toBe(night)
    })

    it('marks a collection page by its link, its key being the page id', () => {
        const collection = rowIcon({ key: '3', title: 'Road trip', url: 'collections/3' })
        expect(collection).toBeDefined()
        expect(rowIcon({ key: '4', path: 'collections/4' })).toBe(collection)
    })

    it('has none for an unknown row or a key that is no row', () => {
        expect(rowIcon({ key: 'something_new' })).toBeUndefined()
        expect(rowIcon({ key: 'constructor' })).toBeUndefined()
        expect(rowIcon({})).toBeUndefined()
    })
})

// The new glyphs are drawn on the chrome grid (styling.md, "Der Chrome-Satz"):
// a 24-unit box and a stroke on every path, so a blanket `fill` rule cannot
// flood them.
describe('the row glyphs are chrome-set drawings', () => {
    const NEW = [
        'artist.plus',
        'calendar.day',
        'cassette',
        'gem',
        'heart.dashed',
        'history',
        'layers',
        'moon.outline',
        'progress',
        'sparkle',
        'sun.outline',
        'tray',
    ]
    it.each(NEW)('%s.svg', name => {
        const svg = readFileSync(`src/assets/icons/${name}.svg`, 'utf-8')
        expect(svg).toMatch(/viewBox="0 0 24 24"/)
        const shapes = [...svg.matchAll(/<(path|circle|rect|polygon|line|ellipse)\b[^>]*>/g)]
        expect(shapes.length).toBeGreaterThan(0)
        for (const [shape, tag] of shapes) {
            expect(tag, `${name}: draw paths, not <${tag}>`).toBe('path')
            expect(shape, `${name}: a path without stroke`).toMatch(/stroke="currentColor"/)
            expect(shape).toMatch(/stroke-width="(2\.4|1\.6)"/)
        }
    })
})
