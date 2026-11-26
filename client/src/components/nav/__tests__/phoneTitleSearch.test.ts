import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

// ---------------------------------------------------------------------------
// Auf dem Handy öffnet der Seitentitel in der Top-Bar („Home", „Favorites",
// „Playlists" …) die Suche mit Eingabefokus — in JEDER View, nicht nur auf Home
// (#603 begann dort, Nutzer 2026-11-25: „allgemein"). Als Shortcut, weil die
// Suche auf dem Handy sonst nur über die Navigation unten erreichbar ist.
// Daneben steht in jeder View das App-Icon, und die Top-Bar trägt auf der
// Playlists-Seite nur noch „New playlist" — der Smart-Playlist-Knopf nahm der
// schmalen Leiste zu viel Platz.
//
// Quelltext-Zensus: Der Titel ist ein Button, sobald es einen Titel gibt, und der Klick
// navigiert zur Suche und setzt danach den Fokus auf das Suchfeld. Der Fokus
// kommt erst nach der Navigation, weil das Feld erst dort gerendert wird —
// und deshalb läuft er über focusAcrossNavigation: iOS öffnet die Tastatur nur
// für einen Fokus IM Tap, ein nackter `push().then(focus)` ließ sie zu.
// Das Verhalten selbst prüft utils/__tests__/focusAcrossNavigation.test.ts.
// ---------------------------------------------------------------------------

const SOURCE = readFileSync('src/components/nav/NavBar.vue', 'utf8')

describe('NavBar: Seitentitel öffnet die Suche', () => {
    it('findet den Titel-Button (Wächter)', () => {
        expect(SOURCE.includes('class="mobile-nav-title-text"'), 'Titel-Button fehlt').toBe(true)
    })

    it('ist in jeder View mit Titel ein Button, nicht nur auf Home', () => {
        expect(SOURCE).toMatch(/<button v-if="mobileTitle" type="button" class="mobile-nav-title-text" @click="openSearch">/)
        // Kein reiner Text-Zweig mehr, der den Titel ohne Button rendert.
        expect(SOURCE).not.toMatch(/<template v-else>\{\{ mobileTitle \}\}<\/template>/)
    })

    it('das App-Icon hängt an keiner Route', () => {
        const btn = SOURCE.match(/<button([^>]*?)class="mobile-nav-logo-btn"/)
        expect(btn, 'Icon-Button fehlt').not.toBeNull()
        expect(btn![1]).not.toContain('v-if')
    })

    it('der Dark-Mode-Knopf steht auf dem Handy nur auf Home', () => {
        expect(SOURCE).toMatch(/<ThemeToggle v-if="lookHasModes\(settings\.look\) && \(!isMobile \|\| route\.name === Routes\.Home\)" \/>/)
    })

    it('Playlists bekommen oben nur „New playlist", keinen Smart-Playlist-Knopf', () => {
        const actions = SOURCE.match(/const headerActions = computed\(\(\) => \{([\s\S]*?)\n\}\)/)
        expect(actions, 'headerActions fehlt').not.toBeNull()
        expect(actions![1]).toContain("'New playlist'")
        expect(actions![1]).not.toMatch(/smart/i)
    })

    it('öffnet die Suche über openSearchFocused, synchron im Klick (iOS-Tastatur)', () => {
        const fn = SOURCE.match(/function openSearch\(\) \{([\s\S]*?)\n\}/)
        expect(fn, 'openSearch fehlt').not.toBeNull()
        // Der Aufruf, nicht nur der Import: synchron im Klick-Handler.
        expect(fn![1]).toMatch(/^\s*(void )?openSearchFocused\(router\)/)
        // Ein später, eigener Fokus nach der Navigation öffnet auf iOS keine Tastatur.
        expect(fn![1]).not.toMatch(/\.then\(/)
    })
})
