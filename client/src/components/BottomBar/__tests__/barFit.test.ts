import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// The desktop player bar on a narrow laptop (reported 2026-11-14): the clock
// and the repeat button ran under the lyrics button, and above 1080px the
// track title was squeezed to a few letters. The cause was a centre with a
// FIXED width — `20rem !important` below 1080px, narrower than the clock and
// five transport buttons it holds (~382px), and 30rem above, which the grid
// gave out before the title got anything.
//
// The geometry itself is measured in a browser (PR: no overlap and no page
// scroll at 901–1440px). This census keeps the three halves of the fix from
// drifting apart again. Stylesheets are read from disk: a `?raw` glob returns
// an empty string for styles under test (testing.md).

const read = (path: string) => readFileSync(path, 'utf8')
const style = (sfc: string) => sfc.slice(sfc.indexOf('<style'))

const BAR = style(read('src/components/BottomBar/BottomBar.vue'))
const LEFT = style(read('src/components/BottomBar/Left.vue'))
const VOLUME = style(read('src/components/BottomBar/Volume.vue'))
const MIXINS = read('src/assets/scss/_mixins.scss')

/** The body of the first `selector {` block, braces balanced. */
function block(css: string, selector: RegExp): string {
    const m = selector.exec(css)
    if (!m) return ''
    let depth = 0
    const start = css.indexOf('{', m.index)
    for (let i = start; i < css.length; i++) {
        if (css[i] === '{') depth++
        if (css[i] === '}' && --depth === 0) return css.slice(start + 1, i)
    }
    return ''
}

describe('desktop player bar fits a narrow laptop', () => {
    it('reads the files it checks', () => {
        // A census over an empty string is green for nothing.
        expect(BAR).toContain('.b-bar')
        expect(block(BAR, /\n {4}\.center \{/)).toContain('gap')
        expect(LEFT).toContain('.track-info')
    })

    it('makes the centre a track that never drops below its own content', () => {
        expect(BAR).toMatch(/grid-template-columns:\s*1fr minmax\(max-content, 30rem\) 1fr/)
    })

    it('gives the centre no width of its own', () => {
        // Desktop declarations only: nested blocks (the phone bar's
        // `width: 100%`, the seek input) and comments are taken out first.
        let centre = block(BAR, /\n {4}\.center \{/).replace(/\/\/.*$/gm, '')
        while (/\{[^{}]*\}/.test(centre)) centre = centre.replace(/[^;{}]*\{[^{}]*\}/g, '')
        expect(centre).toContain('gap')
        // Any fixed width here overrides the track again — the old
        // `width: 20rem !important` is exactly what ran under the right group.
        expect(centre).not.toMatch(/(^|[^-])width:\s*\d/m)
    })

    it('keeps a readable floor under the title on the desktop bar', () => {
        const info = block(LEFT, /\.track-info \{/)
        expect(info).toMatch(/min-width: 901px\)\s*\{\s*min-width: 7rem/)
    })

    it('drops the volume slider and tightens the gaps in the same narrow range', () => {
        expect(MIXINS).toMatch(/@mixin narrowDesktopBar \{\s*@media only screen and \(min-width: 901px\) and \(max-width: 1120px\)/)
        expect(block(VOLUME, /@include narrowDesktopBar \{/)).toMatch(/\.volume-wrap\s*\{\s*display: none/)
        const narrow = block(BAR, /@include narrowDesktopBar \{/)
        expect(narrow).toMatch(/\.left-group,\s*\.right-group\s*\{\s*gap: \$bar-gap-tight/)
        // A running sleep timer would otherwise widen the right group by its
        // label and run the bar past the window again.
        expect(narrow).toMatch(/\.sleep-timer-btn\.active\s*\{[^}]*width: \$bar-control[\s\S]*\.sleep-timer-label\s*\{\s*display: none/)
    })
})
