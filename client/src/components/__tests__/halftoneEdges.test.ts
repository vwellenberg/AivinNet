import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// THE BARS AND THE CONTINUE CARD WEAR THEIR DOTS AT THE ENDS (user, 2026-10-12).
//
// The dots stand at the two ends of the plate and the middle stays white. The
// mask lives in ONE place, the `$edges` shape of `mem-halftone`; the three
// hosts only name its width. A host that wrote its own mask again would drift
// from the other two the next time one of them is tuned — the bars had exactly
// that: two copies of the same gradient, edited by hand in turn.
//
// Read from disk: a raw glob returns `.scss` as an EMPTY string under Vitest
// (testing.md).
// ---------------------------------------------------------------------------

const read = (path: string) => readFileSync(path, 'utf8')

const HOSTS = [
    'src/components/BottomBar/BottomBar.vue',
    'src/components/nav/NavBar.vue',
    'src/components/HomeView/ContinueCard.vue',
]

describe('halftone at the ends', () => {
    it.each(HOSTS)('%s asks the mixin for the edges and writes no mask of its own', path => {
        const src = read(path)
        expect(src).toMatch(/mem-halftone\([^)]*\$edges:\s*25%/)
        expect(src).not.toMatch(/mask-image/)
    })

    it('the mixin leaves the middle clear and the ends full', () => {
        const mixin = read('src/assets/scss/_candy.scss')
        const edges = mixin.match(/@else if \$edges \{\s*-webkit-mask-image:\s*([^;]+);/)
        expect(edges, 'the $edges branch exists').not.toBeNull()
        const gradient = edges![1]
        // full at both outer edges, transparent through the middle
        expect(gradient.startsWith('linear-gradient(to right, #000 0, #000 $edges, transparent')).toBe(true)
        expect(gradient.endsWith('#000 calc(100% - #{$edges}), #000 100%)')).toBe(true)
    })
})
