import { readFileSync } from 'fs'
import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/router', () => ({ Routes: { album: 'album' } }))
const playAlbumAt = vi.fn()
vi.mock('@/helpers/usePlayFrom', () => ({ playAlbumAt: (...a: unknown[]) => playAlbumAt(...a) }))

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
    const KINDS = ['toptrack', 'streams', 'playtime', 'favorites', 'discoveries', 'trackcount']

    it('gives every kind its own shape, and the top tiles the same one', () => {
        const shapes = KINDS.map(shapeOf)
        expect(new Set(shapes).size).toBe(KINDS.length)
        expect(shapeOf('topalbum')).toBe(shapeOf('toptrack'))
    })

    it('draws the shapes the mockup showed: disc, triangle, wave, zigzag, bar — and a sparkle for what is new', () => {
        expect(shapeOf('toptrack')).toBe('circle')
        expect(shapeOf('streams')).toBe('polygon')
        expect(shapeOf('playtime')).toBe('path.line+rotated')
        expect(shapeOf('favorites')).toBe('path.line')
        expect(shapeOf('trackcount')).toBe('rect+rotated')
        expect(shapeOf('discoveries')).toBe('path')
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

    // A one-line value started a line lower than a two-line one (116 vs 85px):
    // the text block stands at the bottom of the tile. Two lines of room, text
    // at the top of it, and the live figure anchored where that text starts.
    it('starts every value at the same line, one line or two', () => {
        const css = read('src/components/Stats/StatItem.vue')
        expect(css).toMatch(/\.count \{[^{}]*min-height: 2lh;/)
        expect(css).toMatch(/\.count-live\s*\{[^}]*top:\s*0;/)
        expect(css).not.toMatch(/\.count-live\s*\{[^}]*bottom:\s*0;/)
    })

    it('leaves a value that is not counted (top tiles) as plain text', () => {
        const w = mount(StatItem, {
            props: { icon: 'toptrack', value: 'Some Song', text: 'top track', image: 'abc.webp' },
            global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
        })
        expect(w.find('.count').classes()).not.toContain('counting')
        expect(w.find('.count').text()).toBe('Some Song')
    })

    // The backend sends a track's cover as `<albumhash>.webp?pathhash=…&fb=track`.
    // Stripping only `.webp` made the link point at an album that does not exist.
    it('links the cover of a top tile to the album, without the image query', () => {
        const w = mount(StatItem, {
            props: {
                icon: 'toptrack',
                value: 'Some Song',
                text: 'top track',
                image: 'f1e2d3c4b5a69788.webp?pathhash=0a1b2c3d4e5f6071&fb=track',
            },
            global: { stubs: { 'router-link': { props: ['to'], template: '<a :data-hash="to.params.albumhash"><slot /></a>' } } },
        })
        expect(w.find('a').attributes('data-hash')).toBe('f1e2d3c4b5a69788')
    })

    describe('a top tile that knows its track', () => {
        const image = 'f1e2d3c4b5a69788.webp?pathhash=0a1b2c3d4e5f6071&fb=track'
        const top = (trackhash?: string) =>
            mount(StatItem, {
                props: { icon: 'toptrack', value: 'Some Song', text: 'top track', image, trackhash },
                global: { stubs: { 'router-link': { template: '<a class="album-link"><slot /></a>' } } },
            })

        it('plays that track in its album when the cover is clicked', async () => {
            playAlbumAt.mockClear()
            await top('abcd1234abcd1234').find('button.statplay').trigger('click')
            expect(playAlbumAt).toHaveBeenCalledWith('f1e2d3c4b5a69788', 0, 'abcd1234abcd1234')
        })

        it('keeps the album link when no track is known', () => {
            const w = top(undefined)
            expect(w.find('button.statplay').exists()).toBe(false)
            expect(w.find('a.album-link').exists()).toBe(true)
        })
    })
})

// "New artists · new albums" (#539) opens the list of them: the tile is one
// button over its whole face. Every other tile stays no control.
describe('StatItem that opens a list', () => {
    const opener = (expanded: boolean, expandable = true) =>
        mount(StatItem, {
            props: {
                icon: 'discoveries',
                value: '7 artists · 12 albums',
                text: 'new this week',
                expandable,
                expanded,
                controls: 'list',
            },
            global: { stubs: { 'router-link': { template: '<a><slot /></a>' } } },
        })

    it('is a button that says whether it is open, and what it opens', async () => {
        const w = opener(false)
        const button = w.find('button.statexpand')

        expect(button.attributes('aria-expanded')).toBe('false')
        expect(button.attributes('aria-controls')).toBe('list')
        expect(button.attributes('aria-label')).toBe('7 artists · 12 albums new this week')
        expect(opener(true).find('button.statexpand').attributes('aria-expanded')).toBe('true')

        await button.trigger('click')
        expect(w.emitted('toggle')).toHaveLength(1)
    })

    it('leaves every other tile without one', () => {
        expect(opener(false, false).find('button.statexpand').exists()).toBe(false)
        expect(tile('streams').find('button.statexpand').exists()).toBe(false)
    })
})

