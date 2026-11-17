import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Die leere Suchseite scrollt nicht seitwärts.
//
// `.search-idle` ist ein Grid. Ohne explizite Spur ist seine Spalte `auto` und
// damit mindestens so breit wie der min-content seines breitesten Kinds — und
// das ist die A–Z-Leiste aus BrowseArtists: 27 Tasten in einer `nowrap`-Reihe.
// Deren eigenes `overflow-x: auto` macht nur die LEISTE zum Scroller, ihre
// intrinsische Breite erreicht das Grid trotzdem. Gemessen auf einem 412-px-Phone
// (Pixel 7): Spalte 1442 px, die ganze Seite ließ sich seitlich verschieben.
// Mit `minmax(0, 1fr)` scrollt nur noch die Leiste (1404/352).
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/views/SearchView/TopResults.vue', 'utf8')

function ruleBody(source: string, selector: string): string {
    const start = source.indexOf(`${selector} {`)
    if (start === -1) return ''
    let depth = 0
    for (let i = source.indexOf('{', start); i < source.length; i++) {
        if (source[i] === '{') depth++
        if (source[i] === '}' && --depth === 0) return source.slice(start, i)
    }
    return ''
}

describe('Suchseite ohne Query: Spaltenbreite', () => {
    const body = ruleBody(SOURCE, '.search-idle')

    it('findet den Block (Wächter)', () => {
        expect(body).toContain('display: grid')
    })

    it('die Spalte darf schmaler werden als die A–Z-Leiste', () => {
        // Kommentare entfernen, damit eine erwähnte Regel nicht als gesetzte zählt.
        const code = body.replace(/\/\/.*$/gm, '')
        expect(code).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)/)
    })
})
