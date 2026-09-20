import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// ⚠️ THE SMALL SPACING TOKENS ARE NOT TYPE SIZES.
//
// `$smaller` and `$small` are gaps and paddings — 0.25rem and 0.5rem. Their
// names read like a type scale, and nothing stops `font-size: $small` from
// compiling. What it produces is **8px text**: half the body size, smaller
// than anything else in the app, and reported by the user as "Untertitel auch
// zu klein" in the metadata dialog.
//
// The mistake is invisible in the file that makes it. `font-size: $small` next
// to `gap: $small` and `padding: $small` reads as consistent — it looks like
// one scale used throughout, which is exactly the assumption that is wrong. It
// survives lint (valid Sass), typecheck (no types involved) and the build (no
// warning), and in a screenshot it is a line of small grey text, which is what
// a subtitle is supposed to look like.
//
// ⚠️ `$medium` is deliberately NOT in this list, and that is a finding rather
// than an omission. The first version of this test banned all four tokens and
// turned up NINE existing components using `font-size: $medium` — the disc bar,
// the player bar, the folder row, the seek bar, the Now-Playing head, the
// settings list, the dropdown and the track duration. At 0.75rem that is 12px,
// a legible small size, and nine files agreeing on it is a convention, not a
// bug. Widening the ban would have been a sweeping restyle nobody asked for,
// hidden inside a bug fix.
//
// So the line is drawn where text stops being readable, not where the naming
// stops being tidy.
// ---------------------------------------------------------------------------

const SOURCES = import.meta.glob('/src/**/*.{vue,scss}', { as: 'raw', eager: true }) as Record<string, string>

/** Spacing tokens too small to be text at any size the app uses. */
const SPACING_TOKENS = ['$smaller', '$small']

/**
 * `font-size: <token>` — with or without `!important`. Arithmetic counts too:
 * `$small * 2` is still a gap doing a type size's job.
 *
 * ⚠️ `$smaller` must be tried BEFORE `$small`, or the alternation matches the
 * `$small` prefix of `$smaller` and the reported hit is the wrong token.
 */
const OFFENDER = new RegExp(String.raw`font-size\s*:\s*[^;{}]*(${SPACING_TOKENS.map(t => '\\' + t).join('|')})\b`, 'g')

function offendersIn(source: string): string[] {
    return (source.match(OFFENDER) || []).map(hit => hit.replace(/\s+/g, ' ').trim())
}

describe('the type scale', () => {
    it('sees the stylesheets it means to check', () => {
        // A source-scanning test goes silently green when its input breaks
        // (.claude/rules/testing.md).
        expect(Object.keys(SOURCES).length).toBeGreaterThan(100)
        expect(offendersIn('a { font-size: $small; }')).toEqual(['font-size: $small'])
        expect(offendersIn('a { font-size: $smaller; }')).toEqual(['font-size: $smaller'])
        // Spacing keeps the tokens; only `font-size` is the offence.
        expect(offendersIn('a { font-size: 0.8rem; gap: $small; padding: $smaller; }')).toEqual([])
        // The grandfathered one, see the header of this file.
        expect(offendersIn('a { font-size: $medium; }')).toEqual([])
    })

    it('never spends a spacing token on a font size', () => {
        const found: string[] = []

        for (const [path, source] of Object.entries(SOURCES)) {
            for (const hit of offendersIn(source)) found.push(`${path}: ${hit}`)
        }

        expect(found).toEqual([])
    })
})

// ---------------------------------------------------------------------------
// The other half of the same report: "das eine ist weiter links orientiert,
// das andere zentral".
//
// ⚠️ A <button> is a grid CONTAINER when told to be, and the UA centres its
// tracks. An auto-sized column is therefore only as wide as its own widest
// line and then sits in the middle of the plate — so two plates of identical
// width held labels of 199px and 364px, each centred, and the short one read
// as centred while the long one read as left-aligned. `width: 100%` on the
// button does not help: it sets the container, not the track inside it.
//
// An explicit `1fr` track absorbs the free space, and the question of where
// the container justifies it never comes up.
// ---------------------------------------------------------------------------

/** Plates that are a <button> laid out as a grid, and must therefore say so. */
const GRID_BUTTON_RULES = [
    { file: '/src/components/modals/FetchMetadata.vue', selector: '.source,\n    .candidate' },
]

describe('a button used as a grid container', () => {
    it.each(GRID_BUTTON_RULES)('$selector declares an explicit track', ({ file, selector }) => {
        const source = SOURCES[file]
        expect(source, `${file} does not exist`).toBeDefined()

        const start = source.indexOf(selector)
        expect(start, `${selector} not found in ${file}`).toBeGreaterThan(-1)

        const block = source.slice(start, start + 900)
        expect(block).toMatch(/display:\s*grid/)
        expect(block, 'an auto track on a <button> is centred by the UA').toMatch(/grid-template-columns:\s*[^;]*1fr/)
    })
})
