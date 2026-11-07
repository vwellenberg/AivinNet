import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Auf dem Handy öffnet das Wort „Home" in der Top-Bar die Suche mit
// Eingabefokus. Als Shortcut, weil die Suche auf dem Handy sonst nur über die
// Navigation unten erreichbar ist.
//
// Quelltext-Zensus: Der Titel ist ein Button auf der Home-Route, und der Klick
// navigiert zur Suche und setzt danach den Fokus auf das Suchfeld. Der Fokus
// kommt erst nach der Navigation, weil das Feld erst dort gerendert wird —
// und deshalb läuft er über focusAcrossNavigation: iOS öffnet die Tastatur nur
// für einen Fokus IM Tap, ein nackter `push().then(focus)` ließ sie zu.
// Das Verhalten selbst prüft utils/__tests__/focusAcrossNavigation.test.ts.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/nav/NavBar.vue', 'utf8')

describe('NavBar: Home-Titel öffnet die Suche', () => {
    it('findet den Titel-Button (Wächter)', () => {
        expect(SOURCE.includes('class="mobile-nav-title-text"'), 'Titel-Button fehlt').toBe(true)
    })

    it('ist nur auf der Home-Route ein Button', () => {
        expect(SOURCE).toMatch(/v-if="route\.name === Routes\.Home"\s+type="button"\s+class="mobile-nav-title-text"\s+@click="openSearch"/)
    })

    it('navigiert zur Suche und fokussiert über focusAcrossNavigation (iOS-Tastatur)', () => {
        const fn = SOURCE.match(/function openSearch\(\) \{([\s\S]*?)\n\}/)
        expect(fn, 'openSearch fehlt').not.toBeNull()
        // Der Aufruf, nicht nur der Import: synchron im Klick-Handler.
        expect(fn![1]).toMatch(/^\s*(void )?focusAcrossNavigation\(/)
        expect(fn![1]).toMatch(/\(\) => router\.push\(\{ name: Routes\.search/)
        expect(fn![1]).toContain("getElementById('globalsearch')")
        // Ein später, eigener Fokus nach der Navigation öffnet auf iOS keine Tastatur.
        expect(fn![1]).not.toMatch(/\.then\(/)
    })
})
