import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// The cover in the player bar is a 3rem SQUARE, at every width.
//
// It stopped being one on the desktop: the title and artist line next to it
// won the flex fight, the box shrank to a sliver while the 48px picture inside
// kept its size, `no-scroll` clipped the overflow, and the 10px corner radius
// on the remaining strip turned the cover into a vertical pill. Measured on the
// deployed client with a five-artist track: 16.9px wide at 1024, 19.6px at
// 1280, and correct at 1440 only because there was room to spare.
//
// `flex-shrink: 0` existed the whole time — inside `@include largePhones`. The
// squeeze was never a phone problem; the phone is just where someone happened
// to see it, so that is where the pin was nailed down. This test is about WHERE
// the declaration sits, which is the entire difference between fixed and not.
//
// It reads the source rather than the browser because jsdom computes no layout.
// The measurement that proves the pixels lives in the PR; this is what keeps
// the rule from sliding back under a media query.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob('/src/components/BottomBar/*.vue', { as: 'raw', eager: true }) as Record<
    string,
    string
>

/**
 * The text of a rule block, WITHOUT anything nested inside it.
 *
 * ⚠️ The tempting `/\{([^{}]*)\}/` matches innermost blocks only, so it would
 * hand back the body of `@include largePhones` and call the media-query-only
 * declaration a pass. Depth is counted here for that reason: only what sits
 * directly in the block survives.
 */
function ownDeclarations(source: string, selector: string): string {
    const start = source.indexOf(selector)
    if (start === -1) return ''

    const open = source.indexOf('{', start)
    if (open === -1) return ''

    let depth = 0
    let out = ''

    for (let i = open; i < source.length; i++) {
        const char = source[i]

        if (char === '{') {
            depth++
            if (depth === 1) continue
        } else if (char === '}') {
            depth--
            if (depth === 0) break
        }

        if (depth === 1) out += char
    }

    return out
}

describe('player bar cover', () => {
    const LEFT = SOURCES['/src/components/BottomBar/Left.vue']

    it('has the file it measures', () => {
        expect(LEFT, 'BottomBar/Left.vue moved — this test measures nothing').toBeTruthy()
        expect(LEFT).toContain('.np-image')
    })

    it('refuses to shrink at every width, not only on phones', () => {
        const own = ownDeclarations(LEFT, '.np-image {')

        expect(own).toMatch(/flex-shrink:\s*0/)
    })

    it('proves the depth check works — the meter is pinned the same way', () => {
        // A second block with the same property, so a broken `ownDeclarations`
        // (one that returns the whole file, say) cannot make the test above
        // pass by accident.
        const own = ownDeclarations(LEFT, '.bar-meter {')

        expect(own).toMatch(/flex-shrink:\s*0/)
        expect(own).not.toMatch(/np-image/)
    })
})
