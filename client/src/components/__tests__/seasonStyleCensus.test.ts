import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// The Halloween layer is drawn by CSS, which no unit test runs. These checks read
// the two stylesheets off disk (the `.scss` glob under test comes back empty, see
// .claude/rules/testing.md) and hold the rules that the user reported on:
//   - the ground lane stands on the player bar, on every layout (feedback: "emojis
//     partly shown behind the bottom bar");
//   - the tile emoji are not hidden on phones (feedback: "no emoji on the tiles");
//   - the vampire's bat flies off the screen and does not fade (feedback, A).
// Each guard first checks its own input is not empty, so a moved file fails loudly.

const PARTICLES = 'src/components/SeasonParticles.vue'
const SEASONS = 'src/assets/scss/Global/_seasons.scss'
const PEEK = 'src/components/SeasonVampire.vue'

const read = (path: string) => readFileSync(path, 'utf8')

/** The text of the first `{ … }` block after `selector`, braces balanced. */
function blockAfter(source: string, selector: string): string {
    const at = source.indexOf(selector)
    if (at < 0) return ''
    const open = source.indexOf('{', at)
    let depth = 0
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++
        else if (source[i] === '}') {
            depth--
            if (depth === 0) return source.slice(open + 1, i)
        }
    }
    return ''
}

describe('the ground lane stands on the player bar', () => {
    const source = read(PARTICLES)

    it('reads the particle stylesheet (parser guard)', () => {
        expect(source.length).toBeGreaterThan(1000)
        expect(source).toContain('.season-particle.is-ground')
    })

    it('anchors to the bar row of each layout, from the shared tokens', () => {
        const rule = source.slice(source.indexOf('.season-particle.is-ground'))
        expect(rule).toContain('#{$bottombarheight} + var(--season-lift')
        expect(rule).toContain('@include allPhones')
        expect(rule).toContain('#{$bottombarheight-phone} + var(--season-lift')
        expect(rule).toContain('@include shortViewport')
        expect(rule).toContain('#{$bottombarheight-short} + var(--season-lift')
    })

    it('drops the viewport-percentage top for the ground lane', () => {
        expect(blockAfter(source, '.season-particle.is-ground')).toContain('top: auto')
    })

    it('draws no ground particle from the old viewport-percentage lanes', () => {
        // The old lanes were `top: 72–84 %` and `55–80 %` of the viewport: a bar
        // covers the bottom 82–152 px of it, so those lanes were partly under it.
        expect(source).not.toMatch(/season-chase[^}]*top:\s*\d+%/)
        expect(source).not.toMatch(/season-pumpkin[^}]*top:\s*\d+%/)
    })
})

describe('the tile emoji show on phones too, standing on the cover edge', () => {
    const seasons = read(SEASONS)

    it('reads the seasons stylesheet (parser guard)', () => {
        expect(seasons.length).toBeGreaterThan(1000)
        expect(seasons).toContain('season-tile-fade')
    })

    it('draws the glyphs in a fixed layer, so no cover overflow clips them', () => {
        expect(blockAfter(seasons, '.season-tile-layer')).toContain('position: fixed')
        expect(blockAfter(seasons, '.season-tile-emoji')).toContain('position: fixed')
        // A cover-level ::after would be clipped by .card-art's overflow: hidden.
        expect(seasons).not.toMatch(/card-art\[data-season-emoji\]::after/)
    })

    it('sits its feet on the top edge: translated up by its own height, 1 px into the frame', () => {
        expect(blockAfter(seasons, '.season-tile-emoji')).toContain('translate: -50% calc(-100% + 1px)')
    })

    it('never hides the emoji under a phone breakpoint', () => {
        // Hidden phones were the bug: the attribute was set, and `display: none` kept it off the screen.
        expect(seasons).not.toMatch(/max-width:\s*459px\)\s*\{[^}]*display:\s*none/)
        expect(seasons).toMatch(/max-width:\s*459px\)\s*\{[^}]*font-size:\s*1\.45rem/)
    })

    it('fades and drops in with a tiny settle: no overshoot, no tilt', () => {
        const keyframes = seasons.slice(seasons.indexOf('@keyframes season-tile-fade'))
        expect(keyframes).not.toMatch(/rotate\(/)
        expect(keyframes).not.toMatch(/scale\(1\.1/)
    })
})

describe('the vampire\'s bat flies off the screen', () => {
    const source = read(PEEK)

    it('reads the peek component (parser guard)', () => {
        expect(source).toContain('@keyframes season-peek-bat')
    })

    it('flies to the computed exit, at full opacity', () => {
        const keyframes = source.slice(source.indexOf('@keyframes season-peek-bat'))
        expect(keyframes).toContain('var(--peek-exit-x')
        expect(keyframes).toContain('var(--peek-exit-y')
        // The 100 % frame keeps the bat visible: no fade to zero in view.
        const last = keyframes.slice(keyframes.indexOf('100%'))
        expect(last.slice(0, last.indexOf('}'))).toContain('opacity: 1')
    })
})

describe('the spider hangs on a thread', () => {
    const seasonParticles = read(PARTICLES)

    it('draws the thread in the theme\'s line colour, a 1 px line', () => {
        const thread = blockAfter(seasonParticles, '.season-spider::before')
        expect(thread).toContain('var(--mem-line)')
        expect(thread).toContain('width: 1px')
    })

    it('lets the spider down and back up within one cycle, with motion tokens only', () => {
        const keyframes = seasonParticles.slice(seasonParticles.indexOf('@keyframes season-spider'))
        expect(keyframes).toContain('var(--season-drop)')
        expect(keyframes).not.toMatch(/\d+(\.\d+)?m?s\b/)
    })
})

describe('Christmas: the tile emoji sink while they fade', () => {
    const seasons = read(SEASONS)

    it('reads the seasons stylesheet (parser guard)', () => {
        expect(seasons).toContain('html.season-christmas.season-scrolled')
    })

    it('drops a little on scroll, and fades on the same scrolled state', () => {
        const sink = blockAfter(seasons, 'html.season-christmas.season-scrolled .season-tile-emoji')
        expect(sink).toMatch(/transform:\s*translateY\(1rem\)/)
        expect(blockAfter(seasons, '&.season-scrolled .season-tile-emoji')).toContain('opacity: 0')
    })

    it('moves with the motion tokens, not a literal duration', () => {
        const base = blockAfter(seasons, '.season-tile-emoji')
        expect(base).toContain('transform $motion-settle $motion-curve')
        expect(base).toContain('opacity $motion-move $motion-curve')
        expect(base).not.toMatch(/\d(\.\d+)?m?s\b/)
    })
})

describe('Christmas: the fairy lights on the top bar', () => {
    const seasons = read(SEASONS)
    const navbar = read('src/components/nav/NavBar.vue')

    it('reads the lights markup and stylesheet (parser guard)', () => {
        expect(navbar).toContain('class="topnav-lights"')
        expect(seasons).toContain('@keyframes season-light-twinkle')
    })

    it('is decoration: hidden from assistive tech, and takes no pointer', () => {
        expect(navbar).toMatch(/class="topnav-lights"\s+aria-hidden="true"/)
        expect(blockAfter(seasons, '.topnav > .topnav-lights')).toContain('pointer-events: none')
        expect(blockAfter(seasons, 'html.season-christmas .topnav > .topnav-lights')).toContain('display: block')
    })

    it('sits absolutely in the bar, so it takes no room and shifts no layout', () => {
        const lights = blockAfter(seasons, '.topnav > .topnav-lights')
        expect(lights).toContain('position: absolute')
        expect(lights).toContain('height: 0')
    })

    it('twinkles on a staggered phase, with motion tokens only', () => {
        const dot = blockAfter(seasons, 'html.season-christmas .topnav > .topnav-lights {')
        expect(dot).toContain('--light-i')
        expect(dot).toMatch(/animation-delay:\s*calc\(var\(--light-i\)/)
        expect(dot).toMatch(/\$motion-settle\s*\*\s*8/)
        expect(dot).not.toMatch(/\d(\.\d+)?m?s\b/)
    })

    it('stays lit under "reduce motion" without a rule of its own: its end frame is fully lit', () => {
        // The global policy (motion-policy.scss) runs every animation straight to its
        // end frame, so the twinkle's 100 % frame is what the lights show then.
        const twinkle = blockAfter(seasons, '@keyframes season-light-twinkle')
        expect(twinkle).toMatch(/100%\s*\{\s*opacity:\s*1;?\s*\}/)
        expect(seasons).not.toMatch(/prefers-reduced-motion[^}]*\{[^}]*topnav-lights/)
    })
})
