import { readFileSync } from 'fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { album: 'album' } }))

import StatItem from '@/components/Stats/StatItem.vue'

// Read from disk, not through `import.meta.glob`: a raw glob returns `.scss` as
// an EMPTY string under Vitest (testing.md).
const read = (path: string) => readFileSync(path, 'utf8')

function tile(icon: string) {
    return mount(StatItem, {
        props: { icon, value: '419 track plays', text: 'this week', image: 'abc.webp' },
        global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
    })
}

// The shape a tile wears, as the element that draws it.
function shapeOf(icon: string) {
    const svg = tile(icon).find('svg.statmotif')
    expect(svg.exists(), `${icon} has a motif`).toBe(true)
    const el = svg.element.firstElementChild!
    return `${el.tagName.toLowerCase()}${el.classList.contains('line') ? '.line' : ''}${el.hasAttribute('transform') ? '+rotated' : ''}`
}

describe('StatItem motif', () => {
    // The kinds /logger/stats really sends (Stats.test.ts), one shape each — a
    // row of five tiles reads as five, not as one texture repeated.
    const KINDS = ['toptrack', 'streams', 'playtime', 'favorites', 'trackcount']

    it('gives every kind its own shape, and the top tiles the same one', () => {
        const shapes = KINDS.map(shapeOf)
        expect(new Set(shapes).size).toBe(KINDS.length)
        expect(shapeOf('topalbum')).toBe(shapeOf('toptrack'))
    })

    it('draws the shapes the mockup showed: disc, triangle, wave, zigzag, bar', () => {
        expect(shapeOf('toptrack')).toBe('circle')
        expect(shapeOf('streams')).toBe('polygon')
        expect(shapeOf('playtime')).toBe('path.line+rotated')
        expect(shapeOf('favorites')).toBe('path.line')
        expect(shapeOf('trackcount')).toBe('rect+rotated')
    })

    it('puts a kind nobody claimed on the zigzag', () => {
        expect(shapeOf('something-new')).toBe(shapeOf('favorites'))
    })

    it('is decoration: hidden from assistive tech, behind the content, never a target', () => {
        const w = tile('streams')
        const svg = w.find('svg.statmotif')
        expect(svg.attributes('aria-hidden')).toBe('true')
        expect(svg.attributes('focusable')).toBe('false')
        // First child: it paints under `.itemcontent`, which is z-index 1.
        expect(w.element.firstElementChild).toBe(svg.element)
    })

    it('keeps the icon, the number and the caption', () => {
        const w = tile('streams')
        expect(w.find('.staticon').exists()).toBe(true)
        expect(w.find('.title').text()).toBe('this week')
        expect(w.find('.count').exists()).toBe(true)
    })
})

describe('StatItem motif styling', () => {
    const vue = read('src/components/Stats/StatItem.vue')
    const style = vue.slice(vue.indexOf('<style'))

    it('left the dots behind: no halftone layer and no cover behind the caption', () => {
        // The dots were cut off at the tile's rounded corners and ran behind the
        // number; the caption needed a cover to stay readable. The motif ends
        // above the text, so none of that is needed any more.
        expect(style).not.toMatch(/mem-halftone|mem-dots-wave/)
        // A `::before` that paints is the old layer; the count box's one is an
        // invisible sizer (text only, `visibility: hidden`).
        expect(style).not.toMatch(/&::before\s*\{[^}]*(background|mem-)/s)
        expect(style).not.toMatch(/mem-hatch-clear|--row-fill/)
        expect(vue).not.toMatch(/--row-fill/)
    })

    it('is the tile ink at low strength, from the palette token, not a literal', () => {
        // `mem-alpha($mem-ink, …)` follows a colour scheme's ink (paletteTokens.test.ts
        // rules out Sass colour functions on `var()`s).
        expect(style).toMatch(/\.statmotif\s*\{[^}]*color:\s*mem-alpha\(\$mem-ink,\s*0\.13\)/s)
        expect(style).not.toMatch(/\.statmotif\s*\{[^}]*#[0-9a-fA-F]{3,6}/s)
    })

    it('can be dropped by a look, and Boring drops it', () => {
        expect(style).toMatch(/display:\s*var\(--shape-motif,\s*block\)/)
        expect(read('src/assets/scss/Global/_theme-stream.scss')).toMatch(/--shape-motif:\s*none/)
        // Memphis keeps the fallback: no Memphis stylesheet defines the token.
        expect(read('src/assets/scss/Global/index.scss')).not.toMatch(/--shape-motif/)
    })

    it('builds up as a wave along the row, on the motif', () => {
        expect(style).toMatch(/@include mem-motif-pop/)
        // The delay has to sit on a MORE specific rule than the shorthand it
        // follows, and on the motif, not on the tile.
        expect(style).toMatch(/\.statitem:nth-child\(#\{\$i\}\)\s+\.statmotif\s*\{\s*animation-delay/)
        expect(read('src/assets/scss/Global/_button-classes.scss')).toMatch(/@keyframes mem-motif-pop/)
        expect(read('src/assets/scss/_candy.scss')).toMatch(/@mixin mem-motif-pop\(\$delay: 0s\)/)
    })
})

describe('StatItem count box', () => {
    const counted = () =>
        mount(StatItem, {
            props: { icon: 'trackcount', value: '12,671 tracks', text: 'in your library' },
            global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
        })

    // The count-up showed figures with wider digits than the final one ("12,671"
    // is mostly narrow 1s), so a figure mid-count wrapped onto a second line and
    // the tile jumped. The box is sized by the final value instead.
    it('sizes a counted value by its final text, whatever figure is showing', () => {
        const count = counted().find('.count')
        expect(count.classes()).toContain('counting')
        expect(count.attributes('data-final')).toBe('12,671 tracks')
        expect(count.find('.count-live').exists()).toBe(true)
    })

    it('draws the final text invisibly and keeps the live figure out of the flow', () => {
        const css = read('src/components/Stats/StatItem.vue')
        expect(css).toMatch(/&::before\s*\{[^}]*content:\s*attr\(data-final\)[^}]*visibility:\s*hidden/s)
        expect(css).toMatch(/\.count-live\s*\{[^}]*position:\s*absolute[^}]*white-space:\s*nowrap/s)
    })

    it('leaves a value that is not counted (top tiles) as plain text', () => {
        const w = mount(StatItem, {
            props: { icon: 'toptrack', value: 'Some Song', text: 'top track', image: 'abc.webp' },
            global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
        })
        expect(w.find('.count').classes()).not.toContain('counting')
        expect(w.find('.count').text()).toBe('Some Song')
    })
})
