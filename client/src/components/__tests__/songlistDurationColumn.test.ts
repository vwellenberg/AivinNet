import { readFileSync, readdirSync, statSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Every track row gives its last column the same width.
//
// That column holds the favourite heart (32px), the duration pill (56px) and
// the ⋯ button (32px) with the row's 16px gaps: 152px of content, plus 8px of
// margin. It was 7.5rem = 120px, and because the group is `justify-content:
// end` it kept its right edge and spilled 40px LEFT — straight over the album
// title. Measured on the deployed client at 1280, 1440 and 1920: the same 40px
// every time, because the shortfall has nothing to do with the viewport.
//
// The number was already right in two places and wrong in four. `.with-plays`
// and `.with-date` were widened to 10rem when someone saw the overflow over the
// Plays column; the base row, both responsive variants and the album page kept
// 7.5rem. That is the shape of this bug — fixed where it was noticed, not where
// it was caused — and it is exactly what a census can hold shut.
//
// ⚠️ Two of the four wrong grids live in a .scss, and `as: "raw"` on a .scss
// returns an EMPTY STRING under test (.claude/rules/testing.md). A single glob
// over both extensions therefore reads the components and silently skips the
// stylesheets — a census that passes on air. Vue files come through Vite,
// stylesheets are read off disk, and the first test asserts that both halves
// arrived with content.
// ---------------------------------------------------------------------------

const VUE_SOURCES = import.meta.glob('/src/**/*.vue', { as: 'raw', eager: true }) as Record<string, string>

function scssFiles(dir: string): string[] {
    const files: string[] = []

    for (const entry of readdirSync(dir)) {
        const path = `${dir}/${entry}`
        if (statSync(path).isDirectory()) files.push(...scssFiles(path))
        else if (entry.endsWith('.scss')) files.push(path)
    }

    return files
}

/** Both halves, keyed alike: `/src/...` for the components, real paths for the sheets. */
const SOURCES: Record<string, string> = {
    ...VUE_SOURCES,
    ...Object.fromEntries(scssFiles('src/assets/scss').map(path => [path, readFileSync(path, 'utf8')])),
}

/** A grid declaration, with the selector block it sits in. */
interface Declaration {
    file: string
    selector: string
    value: string
    /** Whether any enclosing block is a phone media query. */
    phone: boolean
}

/**
 * Every `grid-template-columns` in the client, with the selector chain above it.
 *
 * Depth-tracked rather than regex-matched: the declarations that matter are
 * nested two and three blocks deep (`.songlist-item { &.with-plays { … } }`,
 * `.isSmall { .songlist-item { @include mediumPhones { … } } }`), and a flat
 * pattern cannot tell those apart.
 */
function gridDeclarations(): Declaration[] {
    const out: Declaration[] = []

    for (const [file, source] of Object.entries(SOURCES)) {
        const stack: string[] = []

        for (const raw of source.split('\n')) {
            const line = raw.trim()

            if (line.endsWith('{')) {
                stack.push(line.slice(0, -1).trim())
                continue
            }
            if (line.startsWith('}')) {
                stack.pop()
                continue
            }

            const match = line.match(/^grid-template-columns:\s*([^;]+);/)
            if (!match) continue

            out.push({
                file,
                selector: stack.join(' '),
                value: match[1].trim(),
                phone: stack.some(part => /Phones|phone/i.test(part)),
            })
        }
    }

    return out
}

describe('track row grid', () => {
    const declarations = gridDeclarations()

    it('reads both halves, with content', () => {
        // Not just "a key exists": an empty string is exactly what the .scss
        // glob returns, and it is what this test exists to rule out.
        const withContent = (extension: string) =>
            Object.entries(SOURCES).filter(([file, source]) => file.endsWith(extension) && source.length > 0)

        expect(withContent('.scss').length, 'no .scss content reached this test').toBeGreaterThan(5)
        expect(withContent('.vue').length, 'no .vue content reached this test').toBeGreaterThan(5)
        expect(declarations.length).toBeGreaterThan(5)
    })

    /**
     * Rows, and the caption row that has to line up with them. Matched on the
     * selector chain, so a new variant is picked up without being listed here.
     */
    const rowGrids = declarations.filter(d => /songlist-item|ah-bar/.test(d.selector))

    it('finds the row grids it is supposed to be checking', () => {
        expect(rowGrids.length).toBeGreaterThanOrEqual(5)
    })

    it('sizes the last column from the shared token, everywhere', () => {
        for (const grid of rowGrids) {
            // Phones hide the heart and the ⋯ button outright (`display: none`
            // in TrackDuration.vue), so the column there carries the duration
            // alone and is deliberately narrow.
            if (grid.phone) continue

            const ends =
                grid.value.endsWith('$songlist-duration-col') ||
                grid.value.endsWith('$songlist-duration-col !important') ||
                grid.value === '$songlist-columns-with-date'

            expect(
                ends,
                `${grid.file} — "${grid.selector}" ends its row grid with "${grid.value}"; ` +
                    'the last column has to come from $songlist-duration-col'
            ).toBe(true)
        }
    })

    it('keeps the shared with-date grid on the token too', () => {
        // It is the one grid built from a variable, so the rule above sees only
        // the variable name and would miss a hardcoded width inside it.
        const variables = SOURCES['src/assets/scss/_variables.scss']

        expect(variables).toBeTruthy()
        expect(variables).toMatch(/\$songlist-columns-with-date:.*\$songlist-duration-col;/)
    })
})
