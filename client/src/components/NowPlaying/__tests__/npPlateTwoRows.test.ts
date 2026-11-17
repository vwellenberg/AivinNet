import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// On a phone the track plate takes two rows (2026-11-17): title and artist own
// the first, the three 44px buttons (rating, heart, more) the second, centred.
// With all three beside the text the title got ~120px at 390px and read
// "Echo Bet…". The title is one line again: when it does not fit it scrolls
// (shared/MarqueeText.vue) instead of ending in an ellipsis.
//
// Stylesheets are read from disk: a `?raw` glob returns an empty string for
// styles under test (testing.md). The census looks inside the component's own
// `@include allPhones` block, so a desktop rule cannot satisfy it.

const SRC = readFileSync('src/components/NowPlaying/NowPlayingInfo.vue', 'utf8')
const STYLE = SRC.slice(SRC.indexOf('<style'))

/** Body of the first `opener {` block in `css`, braces balanced. */
function block(css: string, opener: RegExp): string {
    const m = opener.exec(css)
    if (!m) return ''
    const open = css.indexOf('{', m.index)
    let depth = 0
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++
        if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
    }
    return ''
}

const PHONE = block(STYLE, /@include allPhones \{/)

describe('the track plate takes two rows on a phone', () => {
    it('reads the file it checks', () => {
        expect(STYLE).toContain('.now-playing-info')
        expect(PHONE, 'no `@include allPhones` block in NowPlayingInfo.vue').not.toBe('')
    })

    it('wraps the plate so the buttons drop to a second row', () => {
        expect(PHONE).toMatch(/flex-wrap:\s*wrap/)
    })

    it('gives the text column the first row in full', () => {
        expect(block(PHONE, /\.text\s*\{/)).toMatch(/flex:\s*1 1 100%/)
    })

    it('keeps the title on one line and lets MarqueeText handle overflow', () => {
        const title = block(PHONE, /\.title\s*\{/)
        expect(title, 'the 2-line clamp is back').not.toMatch(/-webkit-line-clamp/)
        expect(title).not.toMatch(/white-space:\s*normal/)
        expect(SRC).toMatch(/<MarqueeText class="title" :text="title">/)
    })

    it('centres the buttons on the second row', () => {
        const actions = block(PHONE, /\.actions\s*\{/)
        expect(actions).toMatch(/flex:\s*1 1 100%/)
        expect(actions).toMatch(/justify-content:\s*center/)
        expect(actions, 'the old right-hand push is back').not.toMatch(/margin-left:\s*auto/)
    })
})
