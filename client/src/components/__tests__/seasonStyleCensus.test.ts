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

// The spider and the bell hang by one mechanic: the `is-hanger` class on the particle
// (utils/seasonParticles.ts, hangs). These rules are read off that one selector.
describe('the hangers (spider, bell) hang on a thread', () => {
    const seasonParticles = read(PARTICLES)
    const HANGER = '.season-particle.is-hanger'

    it('reads the hanger rules (parser guard)', () => {
        expect(seasonParticles).toContain(`${HANGER} .season-glyph::before`)
        expect(seasonParticles).toContain('@keyframes season-hang {')
    })

    it('draws the thread in the particle\'s ribbon colour, a 1 px line; the spider keeps the line colour', () => {
        const thread = blockAfter(seasonParticles, `${HANGER} .season-glyph::before`)
        expect(thread).toContain('var(--season-ribbon, var(--mem-line))')
        expect(thread).toContain('width: 1px')
    })

    // "da geht der faden nicht bis zur spinne" (user, 2026-10-31): the thread hung
    // on the particle from the top of the glyph's box while the glyph bobbed and
    // tilted under it, so there was air between thread and spider.
    it('hangs the thread on the glyph and runs it into the body, so no air shows', () => {
        expect(seasonParticles).not.toContain('.season-spider::before')
        const thread = blockAfter(seasonParticles, `${HANGER} .season-glyph::before`)
        expect(thread).toMatch(/bottom:\s*50%/)
        expect(thread).toMatch(/z-index:\s*-1/)
    })

    it('bounces the hanger straight up and down: a tilt would swing the thread', () => {
        const glyph = blockAfter(seasonParticles, `${HANGER} .season-glyph {`)
        expect(glyph).toContain('season-hang-bob')
        const bob = seasonParticles.slice(seasonParticles.indexOf('@keyframes season-hang-bob'))
        expect(bob.slice(0, bob.indexOf('\n}'))).not.toMatch(/rotate\(/)
        // The shared bob (with its tilt) is not applied to the hangers.
        const shared = seasonParticles.slice(0, seasonParticles.indexOf('animation: season-bob'))
        expect(shared.slice(shared.lastIndexOf('}'))).not.toContain('is-hanger')
    })

    it('lets the hanger down and back up within one cycle, with motion tokens only', () => {
        const keyframes = seasonParticles.slice(seasonParticles.indexOf('@keyframes season-hang {'))
        expect(keyframes).toContain('var(--season-drop)')
        expect(keyframes).not.toMatch(/\d+(\.\d+)?m?s\b/)
    })
})

describe('Christmas: the present tumbles along the ground lane', () => {
    const seasonParticles = read(PARTICLES)

    it('reads the tumble rule (parser guard)', () => {
        expect(seasonParticles).toContain('@keyframes season-tumble')
    })

    it('turns the glyph a full turn per wobble, and no tilt bob is applied to it', () => {
        const glyph = blockAfter(seasonParticles, '.season-present .season-glyph {')
        expect(glyph).toContain('season-tumble var(--season-wobble)')
        expect(glyph).not.toContain('season-bob')
        const turn = blockAfter(seasonParticles, '@keyframes season-tumble')
        expect(turn).toContain('rotate(0deg)')
        expect(turn).toContain('rotate(360deg)')
        expect(turn).not.toMatch(/\d+(\.\d+)?m?s\b/)
    })

    it('crosses the ground lane the way the pumpkin does', () => {
        const crossing = blockAfter(seasonParticles, '.season-pumpkin,')
        expect(crossing).toContain('season-cross var(--season-dur)')
        expect(seasonParticles).toContain('.season-present,\n.season-waddle,')
    })
})

describe('Christmas: the penguins waddle as one cluster, on the chase\'s box and offsets', () => {
    const seasonParticles = read(PARTICLES)

    it('reads the waddle rules (parser guard)', () => {
        expect(seasonParticles).toContain('.season-waddle')
    })

    it('sizes the waddle from its cluster box, the same rule as the chase', () => {
        const box = blockAfter(seasonParticles, '.season-chase,\n.season-waddle {')
        expect(box).toContain('var(--season-w, 1)')
        expect(box).toContain('var(--season-h, 1)')
    })

    it('places each penguin at its own offset and bobs it with a stagger, as the horde does', () => {
        const glyph = blockAfter(seasonParticles, '.season-chase .season-glyph,\n.season-waddle .season-glyph {')
        expect(glyph).toContain('var(--season-gx, 0)')
        expect(glyph).toContain('var(--season-gy, 0)')
        expect(glyph).toContain('season-bob var(--season-wobble)')
    })

    it('crosses on the group\'s own width, in the same rule as the chase', () => {
        expect(seasonParticles).toContain('.season-chase,\n.season-present,')
        expect(seasonParticles).toContain('.season-present,\n.season-waddle,\n.season-sleigh {')
    })

    it('keeps the 1.3x runner rule to the chase: the penguins are one size', () => {
        expect(seasonParticles).toContain('.season-chase .season-glyph:first-child')
        expect(seasonParticles).not.toContain('.season-waddle .season-glyph:first-child')
    })
})

describe('Christmas: the shooting star streaks with a gold trail, and the snow drift settles on the bar', () => {
    const seasonParticles = read(PARTICLES)

    it('reads the star and drift rules (parser guard)', () => {
        expect(seasonParticles).toContain('@keyframes season-shoot')
        expect(seasonParticles).toContain('.season-drift {')
    })

    it('draws the trail behind the star in the gold token, fading out, and flies it on the crossing', () => {
        const trail = blockAfter(seasonParticles, '.season-star .season-glyph::before {')
        expect(trail).toContain('linear-gradient(to right, var(--mem-gold), transparent)')
        expect(trail).toMatch(/left:\s*100%/)
        const shoot = blockAfter(seasonParticles, '@keyframes season-shoot')
        expect(shoot).toContain('var(--season-from)')
        expect(shoot).toContain('var(--season-to)')
        expect(shoot).not.toMatch(/\d+(\.\d+)?m?s\b/)
    })

    it('crosses in a short part of its cycle, so it is a streak and not a drift', () => {
        const shoot = blockAfter(seasonParticles, '@keyframes season-shoot')
        // The crossing ends at 1.2 % of the cycle, ~2 s of a 150 s cycle: the rest is off.
        expect(shoot).toMatch(/1\.2%\s*\{[^}]*var\(--season-to\)/)
    })

    it('settles the drift over the stored settle time, with motion tokens and no literal duration', () => {
        const drift = blockAfter(seasonParticles, '.season-drift {')
        expect(drift).toContain('animation: season-drift-settle var(--season-drift-dur)')
        expect(drift).not.toMatch(/\d+(\.\d+)?m?s\b/)
        const settle = blockAfter(seasonParticles, '@keyframes season-drift-settle')
        expect(settle).toContain('scaleY(0)')
        expect(settle).toContain('scaleY(1)')
    })

    it('sits on the player bar\'s top edge from the bar\'s own tokens, out of the flow, on every layout', () => {
        const drift = blockAfter(seasonParticles, '.season-drift {')
        expect(drift).toContain('position: absolute')
        expect(drift).toContain('bottom: calc(#{$bottombarheight} - 2px)')
        expect(drift).toContain('@include allPhones')
        expect(drift).toContain('#{$bottombarheight-phone} - 2px')
        expect(drift).toContain('@include shortViewport')
        expect(drift).toContain('#{$bottombarheight-short} - 2px')
    })

    it('is paused with the layer when the tab is hidden', () => {
        expect(seasonParticles).toContain('.season-particles.is-paused .season-drift')
    })

    it('is wired to the page change: App.vue keys the layer by its navigation count', () => {
        const app = read('src/App.vue')
        expect(app).toContain(':navigation="navigations"')
        expect(app).toMatch(/router\.afterEach\(\(\) => \{\s*navigations\.value \+= 1;/)
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
