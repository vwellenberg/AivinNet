import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE NEW YEAR'S CSS KEEPS ITS RULES (#674).
//
// The fireworks, the pill in the top bar, the party peek and the review card are
// written in CSS, which the unit tests do not see. These census tests read the
// stylesheets from disk (relative to the project root, testing.md) and check the
// rules the feature stands on, each with a guard over its own input.
// ---------------------------------------------------------------------------

const PARTICLES = 'src/components/SeasonParticles.vue'
const PEEK = 'src/components/SeasonVampire.vue'
const PILL = 'src/components/nav/NewYearCountdown.vue'
const CARD = 'src/components/HomeView/YearInMusicCard.vue'
const SEASONS_SCSS = 'src/assets/scss/Global/_seasons.scss'

/** The style block of a single-file component, or the whole file for a stylesheet. */
function styleOf(file: string): string {
    const src = readFileSync(file, 'utf8')
    const start = src.indexOf('<style')
    return start === -1 ? src : src.slice(src.indexOf('>', start) + 1)
}

/**
 * The body of the rule whose selector starts a line (the first one), or ''. A
 * selector that only appears inside another (`.is-paused .season-spark`) does not
 * count, and the body runs to the brace that closes it: `#{…}` interpolations
 * inside it have braces of their own.
 */
function ruleOf(css: string, selector: string): string {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = new RegExp(`(^|\\n)[ \\t]*${escaped} \\{`).exec(css)
    if (!match) return ''
    const open = match.index + match[0].length - 1
    let depth = 0
    for (let i = open; i < css.length; i++) {
        if (css[i] === '{') depth++
        if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
    }
    return ''
}

describe('fireworks: a rocket climbs from the ground lane to the upper third', () => {
    const css = styleOf(PARTICLES)

    it('reads the particle stylesheet (parser guard)', () => {
        expect(css).toContain('@keyframes season-rocket')
        expect(ruleOf(css, '.season-rocket')).toContain('--rocket-rise')
    })

    it('climbs 67 vh less the bar and the lift: from the bar\'s top edge to a third of the way down', () => {
        const rise = ruleOf(css, '.season-rocket')
        expect(rise).toMatch(/--rocket-rise:\s*calc\(67vh - var\(--rocket-bar\) - var\(--season-lift, 0rem\)\)/)
    })

    it('takes its bar height from the same per-layout tokens as the ground lane', () => {
        expect(css).toMatch(/--rocket-bar:\s*#\{\$bottombarheight\}/)
        expect(css).toMatch(/--rocket-bar:\s*#\{\$bottombarheight-phone\}/)
        expect(css).toMatch(/--rocket-bar:\s*#\{\$bottombarheight-short\}/)
    })

    it('stands on the ground lane, which anchors it above the bar (the rocket is never behind it)', () => {
        const ground = ruleOf(css, '.season-particle.is-ground')
        expect(ground).toContain('bottom: calc(#{$bottombarheight} + var(--season-lift, 0rem))')
        const template = readFileSync(PARTICLES, 'utf8')
        expect(template).toMatch(/:class="\[`season-\$\{p\.kind\}`, \{ 'is-ground': p\.ground[,}]/)
    })

    it('runs its climb, head and sparks on the cycle, with no literal duration', () => {
        // The sparkles drift on the snow's own keyframes, so they count by name too.
        for (const name of ['season-rocket', 'season-rocket-head', 'season-spark', 'season-snow']) {
            expect(css).toMatch(new RegExp(`animation: ${name} var\\(--season-dur\\)`))
        }
        expect(css).not.toMatch(/animation:[^;]*\d(\.\d+)?m?s\b[^;]*;/)
    })

    it('takes the spark colour, angle and distance from custom properties, not from the stylesheet', () => {
        const spark = ruleOf(css, '.season-spark')
        expect(spark).toContain('background: var(--spark-colour')
        expect(css).toMatch(/@keyframes season-spark[\s\S]*var\(--spark-angle/)
        expect(css).toMatch(/@keyframes season-spark[\s\S]*var\(--spark-dist/)
        expect(css).toMatch(/@keyframes season-spark[\s\S]*var\(--spark-sag/)
    })

    it('goes out by the end of the burst: the sparks and the head fade to nothing before the cycle ends', () => {
        expect(css).toMatch(/@keyframes season-spark[\s\S]*10\.5%\s*\{\s*opacity: 0/)
        expect(css).toMatch(/@keyframes season-rocket-head[\s\S]*4\.6%,\s*100%\s*\{\s*opacity: 0/)
    })

    it('pauses with the hidden tab like the other particles', () => {
        expect(css).toMatch(/\.season-particles\.is-paused \.season-rocket-head/)
        expect(css).toMatch(/\.season-particles\.is-paused \.season-spark/)
    })
})

describe('the party peek: the burst opens over the head and the figure sinks', () => {
    const css = styleOf(PEEK)

    it('reads the peek stylesheet (parser guard)', () => {
        expect(css).toContain('@keyframes season-peek-party')
        expect(css).toContain('@keyframes season-peek-pop')
    })

    it('runs the figure and the burst on the peek\'s duration, as percentages', () => {
        expect(css).toMatch(/\.season-peek-newyear \.season-peek-figure \{\s*animation: season-peek-party var\(--peek-dur\)/)
        expect(css).toMatch(/\.season-peek-newyear \.season-peek-puff \{[\s\S]*?animation: season-peek-pop var\(--peek-dur\)/)
    })

    it('is never a bat: the party peek does not launch', () => {
        expect(css).not.toMatch(/\.season-peek-newyear \.season-peek-bat/)
    })
})

describe('the pill in the top bar: readable in light and dark, the clock steady', () => {
    const css = styleOf(PILL)
    const pill = ruleOf(css, '.newyear-countdown')

    it('reads the pill stylesheet (parser guard)', () => {
        expect(pill.length).toBeGreaterThan(0)
    })

    it('sets its type and its fill from static tokens, so the mode does not change them', () => {
        expect(pill).toMatch(/color:\s*\$candy-black;/)
        expect(pill).toMatch(/background:\s*var\(--mem-yellow\);/)
    })

    it('never takes a text colour from a theme token that flips with the mode', () => {
        expect(pill).not.toMatch(/color:\s*(var\(--mem-ink|\$mem-ink|\$mem-content|var\(--mem-content|\$candy-text|var\(--mem-paper)/)
    })

    it('draws the digits in tabular figures, so the clock ticks without the pill moving', () => {
        expect(pill).toContain('font-variant-numeric: tabular-nums;')
        expect(pill).toContain('white-space: nowrap;')
        expect(pill).toContain('flex-shrink: 0;')
    })

    it('takes no pointer and runs no animation of its own', () => {
        expect(pill).toContain('pointer-events: none;')
        expect(css).not.toMatch(/animation:/)
        expect(css).not.toMatch(/transition:/)
    })
})

describe('the review card: a reading plate, its text on the veil', () => {
    const css = styleOf(CARD)

    it('reads the card stylesheet (parser guard)', () => {
        expect(ruleOf(css, '.year-music-card')).toContain('background-color: var(--mem-veil);')
    })

    it('keeps its text on the plate (--mem-veil), not on the bare ground', () => {
        expect(ruleOf(css, '.year-music-card')).toContain('color: $mem-content-text;')
        expect(css).toContain('@include candy-shadow(4px, 4px);')
    })
})

describe('the New Year\'s tiles and the seasons stylesheet', () => {
    const css = readFileSync(SEASONS_SCSS, 'utf8')

    it('reads the seasons stylesheet (parser guard)', () => {
        expect(css).toContain('.season-tile-emoji')
    })

    it('draws the New Year\'s tile emoji with the same rule as Halloween and Christmas', () => {
        const shared = css.slice(css.indexOf('html.season-halloween,'), css.indexOf('.season-tile-emoji {'))
        expect(shared).toContain('html.season-newyear')
    })
})
