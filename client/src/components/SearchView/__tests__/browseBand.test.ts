import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Der A–Z-Block der Such-Startseite ist EINE Zeile, die seitlich scrollt.
//
// Als Gitter umgebrochen nahm er auf dem Handy rund 270 px ein; die Künstler-
// Reihe darunter begann erst bei y≈400. Der Block ist eine Zeile, weil
// 27 Tasten in einer Zeile bei 44 px Höhe die Reihe darunter wieder auf den
// Schirm holen. Ein `overflow` schneidet Schatten ab (styling.md), deshalb
// reserviert die Zeile rechts und unten Platz.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/SearchView/BrowseArtists.vue', 'utf8')

// Der Block `.band { … }` der Styles, ohne die Unterregeln (`.band-key`).
const BAND_RULE = SOURCE.match(/\n {2}\.band \{([\s\S]*?)\n {2}\}/)

describe('BrowseArtists: Buchstabenblock', () => {
    it('findet die .band-Regel (Wächter)', () => {
        expect(BAND_RULE, '.band-Regel fehlt').not.toBeNull()
    })

    it('läuft in einer Zeile statt umzubrechen', () => {
        expect(BAND_RULE![1]).toMatch(/flex-wrap:\s*nowrap/)
    })

    it('scrollt seitlich, wenn die Tasten nicht passen', () => {
        expect(BAND_RULE![1]).toMatch(/overflow-x:\s*auto/)
    })

    it('reserviert Platz für den Schatten der letzten Taste', () => {
        // Der Schatten fällt nach rechts und unten (candy-shadow), ein
        // overflow-Kasten ohne Reserve schneidet ihn ab.
        expect(BAND_RULE![1]).toMatch(/padding:[^;]*\bsmall\b|padding-right|padding-bottom/)
    })
})
