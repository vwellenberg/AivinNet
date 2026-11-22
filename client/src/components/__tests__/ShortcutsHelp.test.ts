import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { nextTick } from 'vue'

import ShortcutsHelp from '../ShortcutsHelp.vue'
import { closeShortcutsHelp, openShortcutsHelp, shortcutsHelpOpen } from '@/stores/shortcutsHelp'
import { SHORTCUTS } from '@/utils/shortcuts'

describe('ShortcutsHelp overlay', () => {
    let wrapper: VueWrapper | null = null

    beforeEach(() => {
        closeShortcutsHelp()
    })

    afterEach(() => {
        wrapper?.unmount()
        wrapper = null
        document.body.innerHTML = ''
        closeShortcutsHelp()
    })

    const panel = () => document.querySelector<HTMLElement>('.sh-panel')

    it('is closed until opened', () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        expect(panel()).toBeNull()
    })

    it('renders every entry of the shared list as a dialog', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()

        const dialog = panel()!
        expect(dialog.getAttribute('role')).toBe('dialog')
        expect(dialog.getAttribute('aria-modal')).toBe('true')
        const text = dialog.textContent ?? ''
        // Guard: the overlay is built from the list, so every description must show.
        expect(SHORTCUTS.length).toBeGreaterThan(10)
        for (const s of SHORTCUTS) expect(text).toContain(s.description)
    })

    it('Escape closes it, and the key does not reach the rest of the page', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()

        let reached = false
        const probe = (e: KeyboardEvent) => {
            reached = true
            void e
        }
        window.addEventListener('keydown', probe)
        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
        window.removeEventListener('keydown', probe)

        expect(shortcutsHelpOpen.value).toBe(false)
        expect(reached).toBe(false)
    })

    it('a ? pressed inside the panel closes it', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()

        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }))
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('a click on the backdrop closes it', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()

        document.querySelector<HTMLElement>('.sh-bg')!.click()
        await nextTick()
        expect(shortcutsHelpOpen.value).toBe(false)
        expect(panel()).toBeNull()
    })

    it('the close button is a real button with a name', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()

        const close = document.querySelector<HTMLButtonElement>('.sh-close')!
        expect(close.tagName).toBe('BUTTON')
        expect(close.getAttribute('aria-label')).toBe('Close keyboard shortcuts')
        close.click()
        await nextTick()
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('takes focus on open and hands it back to the element that had it on close', async () => {
        const opener = document.createElement('button')
        opener.textContent = 'elsewhere'
        document.body.appendChild(opener)
        opener.focus()

        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()
        await nextTick()
        expect(document.activeElement).toBe(panel())

        closeShortcutsHelp()
        await nextTick()
        expect(document.activeElement).toBe(opener)
    })

    it('a held ? does not close the list it just opened', async () => {
        // The key repeats; the repeats land on the panel, which closed on each.
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()
        await nextTick()
        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, repeat: true, bubbles: true, cancelable: true }))
        expect(shortcutsHelpOpen.value).toBe(true)

        panel()!.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true, cancelable: true }))
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('Tab reaches the close button and stays in the dialog', async () => {
        wrapper = mount(ShortcutsHelp, { attachTo: document.body })
        openShortcutsHelp()
        await nextTick()
        await nextTick()
        const e = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
        panel()!.dispatchEvent(e)
        expect(e.defaultPrevented).toBe(true)
        expect(document.activeElement).toBe(document.querySelector('.sh-close'))
    })
})
