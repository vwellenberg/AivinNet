import { readFileSync } from 'fs'
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
        expect(src).toMatch(/&::before \{\s*@include mem-halftone\(\$reach: null\);/)
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
        expect(grid).toMatch(/@include allPhones \{[^}]*&::before \{\s*@include mem-halftone\(\$reach: null\);\s*grid-area: nav;[^}]*bottom: calc\(-1 \* #\{\$app-grid-gap\}\);/)
    })

    it('on phones the strip is symmetric: one row above the pill, one below', () => {
        const grid = read('src/assets/scss/Global/app-grid.scss')
        // Whole tiles, so the first and the last row sit the same distance
        // from their edge, whatever the pill's height.
        expect(grid).toMatch(/&::before \{\s*@include mem-halftone\(\$reach: null\);\s*grid-area: nav;(?:[^{}]|#\{[^}]*\})*background-repeat: round;/)
        // The strip reaches across the row gap, so the pill's bottom margin
        // gives the gap back: the same $medium of dots on both sides.
        expect(grid).toMatch(/\.topnav \{[\s\S]*?@include allPhones \{[^}]*margin: \$medium 1rem calc\(#\{\$medium\} - #\{\$app-grid-gap\}\);/)
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
})
