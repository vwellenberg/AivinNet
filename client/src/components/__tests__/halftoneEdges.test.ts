import { readdirSync, readFileSync, statSync } from 'fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE TOP BAR WEARS ITS DOTS AT THE ENDS (user, 2026-10-12). THE CONTINUE CARD IS
// DOTTED ALL OVER AND ITS TEXT DIMS THEM (`mem-dots-veil`, user 2026-10-16), ON THE
// DESKTOP AND ON PHONES.
// THE BOTTOM BAR WEARS NONE: its ground stays plain.
//
// The dots stand at the two ends of the plate and the middle stays white. The
// mask lives in ONE place, the `$edges` shape of `mem-halftone`; each host only
// names its width. A host that wrote its own mask again would drift
// from the other two the next time one of them is tuned — the bars had exactly
// that: two copies of the same gradient, edited by hand in turn.
//
// Read from disk: a raw glob returns `.scss` as an EMPTY string under Vitest
// (testing.md).
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')

const HOSTS: [string, string][] = [['src/components/nav/NavBar.vue', '10%']]

describe('halftone at the ends', () => {
    it.each(HOSTS)('%s asks the mixin for its edges and writes no mask of its own', (path, width) => {
        const src = read(path)
        expect(src).toMatch(new RegExp('mem-halftone\\([^)]*\\$edges:\\s*' + width))
        expect(src).not.toMatch(/mask-image/)
    })

    it('the bottom bar wears no dots', () => {
        expect(read('src/components/BottomBar/BottomBar.vue')).not.toMatch(/mem-halftone/)
    })

    it('the continue card is dotted all over, and its text dims the dots (veil)', () => {
        // The general rule for text on dots (user, 2026-10-16, mockup C): no
        // fixed line, no box per label — a soft veil of the surface's fill.
        const src = read('src/components/HomeView/ContinueCard.vue')
        expect(src).toMatch(/&::before \{\s*@include mem-halftone\(\$reach: null, \$on: accent\);/)
        expect(src).toMatch(/\.info \{[^}]*@include mem-dots-veil;/)
        expect(src).toMatch(/\.kicker \{[^}]*@include mem-dots-veil;/)
        // The labels on the dots no longer take a cover each (the row plates
        // below keep theirs: that is text over hatch, a different rule).
        const labels = src.match(/\.kicker,\s*\.meta,\s*\.name \{[^}]*\}/)?.[0] ?? ''
        expect(labels, 'the label rule exists').not.toBe('')
        expect(labels).not.toMatch(/mem-hatch-clear|background/)

        const mixin = read('src/assets/scss/_candy.scss')
        const veil = mixin.match(/@mixin mem-dots-veil\([^)]*\) \{[\s\S]*?\n\}/)?.[0] ?? ''
        expect(veil, 'the veil mixin exists').not.toBe('')
        // Isolated, so the veil sits between the surface and the host's content;
        // painted in the surface's own fill, feathered.
        expect(veil).toMatch(/isolation: isolate;/)
        expect(veil).toMatch(/@include mem-veil-layer\(\$strength\);/)
        expect(veil).toMatch(/filter: blur\(/)
    })

    it('on phones the pill stays white, the dots cover the strip around it', () => {
        // Not inside the pill…
        const nav = read('src/components/nav/NavBar.vue')
        expect(nav).toMatch(/mem-halftone\([^)]*\);\s*[^}]*@include allPhones\s*\{\s*display:\s*none/)
        // …but on the whole nav row around it, edge to edge (no mask: no
        // $edges, $band or $reach), drawn by the grid so the pill paints over it.
        const grid = read('src/assets/scss/Global/app-grid.scss')
        expect(grid).toMatch(/@include allPhones \{[^}]*&::before \{\s*@include mem-halftone\(\$reach: null(?:, \$on: surface)?\);\s*grid-area: nav;/)
    })

    it('on phones the strip is symmetric: one row above the pill, one below', () => {
        const grid = read('src/assets/scss/Global/app-grid.scss')
        // Whole tiles, so the first and the last row sit the same distance
        // from their edge, whatever the pill's height.
        const strip = grid.match(/&::before \{\s*@include mem-halftone\(\$reach: null\);\s*grid-area: nav;([^{}]*)\}/)
        expect(strip, 'the phone strip').not.toBeNull()
        expect(strip![1]).toMatch(/background-repeat: round;/)
        // The strip is the nav row and nothing else: no row gap on phones for
        // it to reach across (that gap put two rows below the pill, one above).
        expect(strip![1]).not.toMatch(/\b(top|bottom|inset):/)
        expect(grid).toMatch(/#app-grid \{[\s\S]*?@include allPhones \{[^}]*grid-template-rows: auto 1fr auto;[^}]*row-gap: 0;/)
        // The pill sits with the same space above and below: $medium in the
        // portrait's auto row, centred (auto margins) in the landscape's fixed one.
        const topnav = grid.slice(grid.indexOf('\n.topnav {'))
        expect(topnav).toMatch(/^\n\.topnav \{[\s\S]*?@include allPhones \{[^}]*margin: \$medium 1rem;/)
        expect(topnav).toMatch(/@include shortViewport \{[\s\S]*?@include allPhones \{[^}]*margin: auto 1rem;/)
    })

    it('the continue card has one dot layer for every width, no mask of its own', () => {
        const src = read('src/components/HomeView/ContinueCard.vue')
        expect(src.match(/@include mem-halftone\(/g)?.length).toBe(1)
        expect(src).not.toMatch(/mask-image/)
    })

    it('the mixin leaves the middle clear and the ends full', () => {
        const mixin = read('src/assets/scss/_candy.scss')
        const edges = mixin.match(/@else if \$edges \{[\s\S]*?-webkit-mask-image:\s*([^;]+);/)
        expect(edges, 'the $edges branch exists').not.toBeNull()
        const gradient = edges![1]
        // full at both outer edges, transparent through the middle
        expect(gradient.startsWith('linear-gradient(to right, #000 0, #000 $edges, transparent')).toBe(true)
        expect(gradient.endsWith('#000 calc(100% - #{$right-edge}), #000 100%)')).toBe(true)
    })

    // The dot colour answers the fill underneath, like the hatch: ink on the
    // light ground and panels, quiet paper on the dark ones (user, 2026-10-17),
    // static ink on an accent.
    it('dots on the ground and panels follow the theme, dots on an accent stay ink', () => {
        const root = read('src/assets/scss/Global/index.scss')
        expect(root).toMatch(/--mem-halftone-dot: #\{mem-alpha\(\$mem-ink, [\d.]+\)\};/)
        const dark = root.slice(root.indexOf('body.theme-dark {'))
        expect(dark).toMatch(/^body\.theme-dark \{(?:[^{}]|#\{[^}]*\})*?--mem-halftone-dot: #\{mem-alpha\(\$mem-dark-line, 0\.[12]\d*\)\};/)

        const mixin = read('src/assets/scss/_candy.scss')
        expect(mixin).toMatch(/@mixin mem-halftone\([^)]*\$on: surface\)/)
        // Anything but `accent` reads the themed colour, as in mem-hatch: a typo
        // must not bring back the invisible ink dots on the dark ground.
        expect(mixin).toMatch(/@if \$on != accent \{ \$dot-color: var\(--mem-halftone-dot, #\{\$dot-color\}\); \}/)
    })

    // Collected, not listed: a new host has to say what it sits on. On a
    // pastel that stays light in the dark theme, the default (paper dots) would
    // all but vanish; on the ground or a panel, `accent` would bring back the
    // invisible ink dots.
    it('every dotted surface is named, with the fill it sits on', () => {
        const SITS_ON: Record<string, 'surface' | 'accent'> = {
            'src/assets/scss/Global/app-grid.scss': 'surface', // the phone strip, on the ground
            'src/components/nav/NavBar.vue': 'surface', // the desktop top bar, a panel
            'src/components/LeftSidebar/index.vue': 'surface', // the sidebar plate, a panel
            'src/components/HomeView/ContinueCard.vue': 'accent', // a pastel, light in both themes
        }
        const walk = (dir: string): string[] =>
            readdirSync(dir).flatMap((e) => {
                const p = `${dir}/${e}`
                if (statSync(p).isDirectory()) return walk(p)
                return /\.(vue|scss)$/.test(e) ? [p] : []
            })
        const hosts: Record<string, string[]> = {}
        for (const f of walk('src')) {
            const calls = read(f).match(/@include mem-halftone\([^)]*\)/g)
            if (calls) hosts[f] = calls
        }
        expect(Object.keys(hosts).sort()).toEqual(Object.keys(SITS_ON).sort())
        for (const [f, calls] of Object.entries(hosts)) {
            for (const c of calls) {
                if (SITS_ON[f] === 'accent') expect(c, f).toMatch(/\$on: accent/)
                else expect(c, f).not.toMatch(/\$on: accent/)
            }
        }
    })
})
