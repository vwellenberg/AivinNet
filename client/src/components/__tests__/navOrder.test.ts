import { readFileSync } from 'node:fs'
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

    it('hält Nachbarn messbar auseinander', () => {
        // Zwei Nachbarn, die als Pastell zu ähnlich sind, liest man als EINE
        // Farbe (Grün über Teal tat genau das). Früher als Warm/Kühl-Wechsel
        // formuliert; seit Runde 3 der Palette (2026-10-04) direkt gemessen:
        // CIE76-Abstand der echten Pastelltöne aus _candy.scss, so wie sie
        // die Navigation malt (mem-pastel, 55 % zum Papier gemischt).
        const candy = readFileSync('src/assets/scss/_candy.scss', 'utf-8')
        const hex = (name: string) => {
            const m = candy.match(new RegExp(`\$${name}:\s*(#[0-9a-fA-F]{6})`))
            expect(m, `$${name} nicht gefunden`).not.toBeNull()
            return m![1]
        }
        const map = candy.slice(candy.indexOf('$mem-nav-tints: ('))
        const tint = (cls: string) => {
            const key = cls.replace(/^tint-/, '')
            const m = map.match(new RegExp(`"${key}":\s*\$([a-z-]+)`))
            expect(m, `${cls} steht nicht in $mem-nav-tints`).not.toBeNull()
            return pastel(hex(m![1]), hex('mem-paper'))
        }

        const farben = eintraege.map(e => tint(e.tint as string))
        for (let i = 0; i < farben.length - 1; i++) {
            const d = deltaE(farben[i], farben[i + 1])
            expect(d, `${namen[i]} und ${namen[i + 1]} liegen nur ΔE ${d.toFixed(0)} auseinander`).toBeGreaterThanOrEqual(20)
        }
    })
})

// --- Farbmessung (sRGB -> CIELAB, D65) ------------------------------------
function rgb(h: string): number[] {
    return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
}
/** mem-pastel: `mix($color, $mem-paper, 55%)` — Sass mischt linear in sRGB. */
function pastel(farbe: string, papier: string): number[] {
    const a = rgb(farbe), b = rgb(papier)
    return a.map((v, i) => v * 0.55 + b[i] * 0.45)
}
function lab(c: number[]): number[] {
    const lin = c.map(u => (u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4))
    const [r, g, b] = lin
    const X = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047
    const Y = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const Z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883
    const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116)
    return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))]
}
function deltaE(a: number[], b: number[]): number {
    const [l1, a1, b1] = lab(a), [l2, a2, b2] = lab(b)
    return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}
