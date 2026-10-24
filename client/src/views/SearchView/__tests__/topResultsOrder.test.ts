import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Die Toptreffer stehen oben, nicht hinter der Playlist-Reihe.
//
// Auf dem Handy (390×844) stand bei einer Suche zuerst die Playlist-Reihe mit
// großen Karten; „Top Result" und die ersten Titel begannen erst bei y≈590 und
// lagen damit hinter der Player-Leiste. Der Test liest den Quelltext, weil die
// Reihenfolge der Blöcke im Template die ganze Aussage ist — ein Render-Test
// würde denselben Stand über Stores und Mocks prüfen, ohne den Fehler zu sehen.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/views/SearchView/TopResults.vue', 'utf8')

// Die Blöcke sind über ihren Inhalt eindeutig; die Wächter unten sorgen dafür,
// dass der Test nicht still grün wird, wenn ein Marker umbenannt wird.
const TOP_RESULT = 'Top Result'
const PLAYLISTS = "title=\"'Playlists'\""
const ARTISTS = "title=\"'Artists'\""
const ALBUMS = "title=\"'Albums'\""

describe('TopResults: Reihenfolge', () => {
    it('findet jeden Block im Template (Wächter)', () => {
        for (const marker of [TOP_RESULT, PLAYLISTS, ARTISTS, ALBUMS]) {
            expect(SOURCE.includes(marker), `${marker} fehlt`).toBe(true)
        }
    })

    it('stellt die Toptreffer vor die Playlists', () => {
        expect(SOURCE.indexOf(TOP_RESULT)).toBeLessThan(SOURCE.indexOf(PLAYLISTS))
    })

    it('behält Artists und Albums hinter den Toptreffern', () => {
        expect(SOURCE.indexOf(TOP_RESULT)).toBeLessThan(SOURCE.indexOf(ARTISTS))
        expect(SOURCE.indexOf(TOP_RESULT)).toBeLessThan(SOURCE.indexOf(ALBUMS))
    })
})
