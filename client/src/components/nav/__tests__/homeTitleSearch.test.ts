import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Auf dem Handy öffnet das Wort „Home" in der Top-Bar die Suche mit
// Eingabefokus. Als Shortcut, weil die Suche auf dem Handy sonst nur über die
// Navigation unten erreichbar ist.
//
// Quelltext-Zensus: Der Titel ist ein Button auf der Home-Route, und der Klick
// navigiert zur Suche und setzt danach den Fokus auf das Suchfeld. Der Fokus
// kommt erst nach der Navigation, weil das Feld erst dort gerendert wird.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/nav/NavBar.vue', 'utf8')

describe('NavBar: Home-Titel öffnet die Suche', () => {
    it('findet den Titel-Button (Wächter)', () => {
        expect(SOURCE.includes('class="mobile-nav-title-text"'), 'Titel-Button fehlt').toBe(true)
    })

    it('ist nur auf der Home-Route ein Button', () => {
        expect(SOURCE).toMatch(/v-if="route\.name === Routes\.Home"\s+type="button"\s+class="mobile-nav-title-text"\s+@click="openSearch"/)
    })

    it('navigiert zur Suche und setzt danach den Fokus', () => {
        const fn = SOURCE.match(/function openSearch\(\) \{([\s\S]*?)\n\}/)
        expect(fn, 'openSearch fehlt').not.toBeNull()
        expect(fn![1]).toContain('Routes.search')
        expect(fn![1]).toMatch(/\.then\(\(\) => nextTick\(/)
        expect(fn![1]).toContain("getElementById('globalsearch')")
    })
})
