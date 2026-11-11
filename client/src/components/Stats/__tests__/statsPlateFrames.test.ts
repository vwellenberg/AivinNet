import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Every reading plate on Stats is framed. The records board drew its tiles as
// a veil with no border and no shadow, so next to the framed skip-rate,
// devices, calendar and clock panels they read as boxes with their edge
// missing (reported 2026-10-30). A plate here is a style block that paints the
// veil; it has to draw the frame and the offset shadow too.
//
// The one-line notes ("Nothing played yet", "Nothing heard for the first time")
// are plates too when they paint the veil: they stand in for a missing panel
// and sat there with no edge (reported 2026-11-05). Notes INSIDE a framed panel
// paint no veil of their own and are not matched.
// ---------------------------------------------------------------------------

const DIR = 'src/components/Stats'
const FILES = readdirSync(DIR)
    .filter(name => name.endsWith('.vue'))
    .map(name => ({ name, source: readFileSync(`${DIR}/${name}`, 'utf8') }))

/** Innermost style blocks: `selector { declarations }` with no nested braces. */
function blocks(source: string) {
    const style = source.slice(source.indexOf('<style'))
    return [...style.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({
        selector: m[1].trim().split('\n').pop()!.trim(),
        body: m[2],
    }))
}

const PLATES = FILES.flatMap(({ name, source }) =>
    blocks(source)
        .filter(b => /background-color:\s*var\(--mem-veil\)/.test(b.body))
        .map(b => ({ where: `${name} ${b.selector}`, body: b.body })),
)

describe('Stats: every reading plate is framed', () => {
    it('finds the plates (guard over the parser)', () => {
        const where = PLATES.map(p => p.where)
        expect(where).toContain('RecordsBoard.vue .records-plate')
        expect(where).toContain('SkipRate.vue .skip-plate')
        expect(where).toContain('Discoveries.vue .discoveries-note')
        expect(where).toContain('RecordsBoard.vue .records-note')
        expect(PLATES.length).toBeGreaterThanOrEqual(5)
    })

    it.each(PLATES)('$where draws a frame and an offset shadow', ({ body }) => {
        expect(body).toMatch(/border:\s*\$candy-border\b/)
        expect(body).toMatch(/candy-shadow|mem-shadow\(/)
    })
})
