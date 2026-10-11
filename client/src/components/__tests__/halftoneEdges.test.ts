import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE TOP BAR AND THE CONTINUE CARD WEAR THEIR DOTS AT THE ENDS (user, 2026-10-12).
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

const HOSTS: [string, string][] = [
    ['src/components/nav/NavBar.vue', '10%'],
    ['src/components/HomeView/ContinueCard.vue', '5%'],
]

describe('halftone at the ends', () => {
    it.each(HOSTS)('%s asks the mixin for its edges and writes no mask of its own', (path, width) => {
        const src = read(path)
        expect(src).toMatch(new RegExp('mem-halftone\\([^)]*\\$edges:\\s*' + width))
        expect(src).not.toMatch(/mask-image/)
    })

    it('the bottom bar wears no dots', () => {
        expect(read('src/components/BottomBar/BottomBar.vue')).not.toMatch(/mem-halftone/)
    })

    it('the continue card dots more on its right than on its left', () => {
        const src = read('src/components/HomeView/ContinueCard.vue')
        expect(src).toMatch(/\$edges:\s*5%,\s*\$right:\s*40%/)
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
