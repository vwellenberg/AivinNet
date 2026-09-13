import { describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Die Reihenfolge der Navigation IST eine Entscheidung, keine Laune.
//
// Sie gilt an zwei Stellen: `NavButtons.vue` rendert sie in der Seitenleiste
// und — über `BottomBar.vue` — in der Navigationszeile am Telefon. Dort sind
// `stats` und der Trenner per CSS ausgeblendet; sichtbar sind genau die fünf
// Einträge davor. Eine Umsortierung entscheidet also mit, was am Telefon
// überhaupt erscheint, und das sieht man dem Array nicht an.
//
// Zwei Regeln stehen bisher nur als Kommentar in `navitems.ts` und sind damit
// genau so haltbar wie die Aufmerksamkeit des Nächsten:
//
//   1. ZIELE oben, WERKZEUGE unten — die Bedeutung des Trenners.
//   2. Die Farbfolge wechselt warm/kühl, und die beiden rötlichen Töne
//      (Pink, Koralle) bleiben getrennt. Zu Pastell getönt liegen Grün und
//      Teal so nah beieinander, dass zwei benachbarte Einträge als eine Farbe
//      gelesen werden.
//
// ⚠️ `stores/search` wird gemockt: `navitems.ts` ruft `useSearch()` in der
// `query`-Funktion des Sucheintrags. Ohne Mock zieht der Import eine Pinia-
// Instanz nach, die es im Test nicht gibt — und der Fehler läse sich wie ein
// Problem der Navigation, nicht wie eines des Testaufbaus.
// ---------------------------------------------------------------------------

vi.mock('@/stores/search', () => ({ default: () => ({ query: '' }) }))

const { menus } = await import('../LeftSidebar/navitems')

/** Die Einträge ohne den Trenner, in Reihenfolge. */
const eintraege = menus.filter(m => !m.separator)
const namen = eintraege.map(m => m.name)
const trennerIndex = menus.findIndex(m => m.separator)

/** Was am Telefon wirklich zu sehen ist: alles vor `stats`, ohne Trenner. */
const AM_TELEFON_AUSGEBLENDET = ['stats']

describe('Navigation: Reihenfolge', () => {
    it('hat genau einen Trenner, und er trennt zwei Gruppen', () => {
        expect(menus.filter(m => m.separator)).toHaveLength(1)
        expect(trennerIndex).toBeGreaterThan(0)
        expect(trennerIndex).toBeLessThan(menus.length - 1)
    })

    it('stellt die ZIELE über den Trenner', () => {
        // Orte, an die man will — mehrmals pro Sitzung angesteuert.
        const ziele = menus.slice(0, trennerIndex).map(m => m.name)

        expect(ziele).toEqual(['home', 'playlists', 'favorites'])
    })

    it('stellt die WERKZEUGE darunter', () => {
        // Womit man etwas sucht, plus die Statistik als Gelegenheitsbesuch.
        const werkzeuge = menus.slice(trennerIndex + 1).map(m => m.name)

        expect(werkzeuge).toEqual(['search', 'folders', 'stats'])
    })

    it('lässt die häufigen Ziele am Telefon sichtbar', () => {
        // Am Telefon fallen `stats` und der Trenner per CSS weg. Playlists und
        // Favoriten MÜSSEN in den fünf Übrigen sein — sonst verschwindet ein
        // Hauptziel dort vollständig, ohne dass es am Rechner auffiele.
        const sichtbar = namen.filter(name => !AM_TELEFON_AUSGEBLENDET.includes(name as string))

        expect(sichtbar).toHaveLength(5)
        expect(sichtbar).toContain('playlists')
        expect(sichtbar).toContain('favorites')
    })
})

describe('Navigation: Farbfolge', () => {
    it('gibt jedem Eintrag genau eine Füllung', () => {
        for (const eintrag of eintraege) {
            expect(eintrag.tint, `${eintrag.name} hat keine Füllung`).toMatch(/^tint-[a-z]+$/)
        }

        // Keine Farbe doppelt — sechs Einträge, sechs Töne.
        expect(new Set(eintraege.map(e => e.tint)).size).toBe(eintraege.length)
    })

    it('hält Pink und Koralle auseinander', () => {
        // Die beiden rötlichen Töne nebeneinander lesen sich als ein Farbfehler,
        // nicht als zwei Einträge. Geprüft über die GANZE Liste, nicht je
        // Gruppe: der Trenner ist am Telefon unsichtbar, dort stehen die
        // Nachbarn also direkt beieinander.
        const toene = eintraege.map(e => e.tint)

        for (let i = 0; i < toene.length - 1; i++) {
            const paar = [toene[i], toene[i + 1]]
            const roetlich = paar.filter(t => t === 'tint-pink' || t === 'tint-coral')

            expect(roetlich.length, `${namen[i]} und ${namen[i + 1]} tragen beide einen Rotton`).toBeLessThan(2)
        }
    })

    it('wechselt warm und kühl ab', () => {
        // Grün und Teal liegen als Pastell so nah beieinander, dass zwei kühle
        // Nachbarn als eine Farbe gelesen werden — genau der Befund, aus dem
        // die Regel entstand.
        const KUEHL = ['tint-green', 'tint-teal', 'tint-lavender']
        const istKuehl = eintraege.map(e => KUEHL.includes(e.tint as string))

        for (let i = 0; i < istKuehl.length - 1; i++) {
            expect(
                istKuehl[i] === istKuehl[i + 1],
                `${namen[i]} und ${namen[i + 1]} sind beide ${istKuehl[i] ? 'kühl' : 'warm'}`
            ).toBe(false)
        }
    })
})
