import { readFileSync } from 'node:fs'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import { blocks, ownDeclarations, styleBlock } from '../../__tests__/scssBlocks'
import NoItems from '../NoItems.vue'

// ---------------------------------------------------------------------------
// Das Achselzucken im leeren Zustand (#143).
//
// Als Komponententest und nicht headless am laufenden Client: der leere Zustand
// ist auf einer gefüllten Bibliothek nirgends zu sehen. Vier Routen abgeklappert
// (Suche ohne Treffer, Playlists, Favoriten, ein Ordner) — `.nothing` rendert
// auf keiner davon, weil überall Inhalt liegt. Genau deshalb ist er der richtige
// Ort für Verspieltheit (man sieht ihn fast nie) und der falsche Ort, um sich
// auf einen Sichtbeleg zu verlassen.
//
// Geprüft wird die Anatomie, nicht die Optik: dass die Formen da sind, dass sie
// für Screenreader unsichtbar bleiben und dass sie den Text nicht anfassbar
// überdecken.
// ---------------------------------------------------------------------------

const props = {
    icon: () => h('svg'),
    flag: true,
    title: 'Nichts gefunden',
    description: 'Hier ist es leer.',
}

describe('NoItems', () => {
    it('bringt die vier Memphis-Formen mit', () => {
        const wrapper = mount(NoItems, { props })

        expect(wrapper.find('.nothing-shapes').exists()).toBe(true)
        // Balken, Dreieck, Punkt, Quadrat — die Grundformen des Stils.
        expect(wrapper.findAll('.nothing-shapes i')).toHaveLength(4)
        for (const shape of ['.zig', '.tri', '.dot', '.sq']) {
            expect(wrapper.find(`.nothing-shapes ${shape}`).exists(), `${shape} fehlt`).toBe(true)
        }
    })

    it('versteckt sie vor Screenreadern', () => {
        // Reine Dekoration: für jemanden, der die Seite vorgelesen bekommt,
        // steht hier nichts, was der Text nicht schon sagt.
        const wrapper = mount(NoItems, { props })

        expect(wrapper.find('.nothing-shapes').attributes('aria-hidden')).toBe('true')
    })

    it('rendert gar nichts, wenn der Zustand nicht leer ist', () => {
        // `flag` ist die ganze Bedingung — die Formen dürfen nicht im DOM
        // liegen, während die Liste voll ist.
        const wrapper = mount(NoItems, { props: { ...props, flag: false } })

        expect(wrapper.find('.nothing').exists()).toBe(false)
        expect(wrapper.findAll('.nothing-shapes i')).toHaveLength(0)
    })

    it('lässt Titel und Beschreibung unberührt', () => {
        // Die Formen liegen ÜBER dem Block. Ein Regressionsschutz dagegen, dass
        // jemand sie in den Textfluss schiebt und die Meldung verrutscht.
        const wrapper = mount(NoItems, { props })

        expect(wrapper.text()).toContain('Nichts gefunden')
        expect(wrapper.text()).toContain('Hier ist es leer.')
        // Die Formen tragen selbst keinen Text, sonst läse ihn der Screenreader
        // trotz aria-hidden über die Textextraktion mancher Werkzeuge mit.
        expect(wrapper.find('.nothing-shapes').text()).toBe('')
    })

    it('legt die Meldung auf eine Veil-Platte statt nackt auf den Doodle-Grund', () => {
        // „No results" stand direkt auf dem Grund und war dort unlesbar, wo
        // eine Form unter den Wörtern durchlief (styling.md, `--mem-veil`).
        const wrapper = mount(NoItems, { props })
        const plate = wrapper.find('.nothing-plate')

        expect(plate.exists()).toBe(true)
        expect(plate.text()).toContain('Nichts gefunden')
        expect(plate.text()).toContain('Hier ist es leer.')

        const style = styleBlock(readFileSync('src/components/shared/NoItems.vue', 'utf-8'))
        const decl = ownDeclarations(blocks(style, '.nothing-plate')[0] ?? '')
        expect(decl, 'kein .nothing-plate-Block').toContain('var(--mem-veil)')
        expect(decl).toMatch(/border:\s*\$candy-border/)
    })
})
