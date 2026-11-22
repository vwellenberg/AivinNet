import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import useModal, { ModalOptions } from '@/stores/modal'
import { open as quickPlayOpen, openQuickPlay } from '@/stores/quickPlay'
import { openShortcutsHelp, shortcutsHelpOpen } from '@/stores/shortcutsHelp'

// Quick play and the shortcut list sit above the modal layer (z-index 70 over
// 60). A modal opening while one of them is up (the login after a 401) landed
// underneath it and could not be clicked. Opening a modal closes both.
describe('a modal closes the keyboard boxes above it', () => {
    beforeEach(() => {
        setActivePinia(createPinia())
        quickPlayOpen.value = false
        shortcutsHelpOpen.value = false
    })

    it('closes quick play', () => {
        openQuickPlay()
        useModal().showModal(ModalOptions.login)
        expect(quickPlayOpen.value).toBe(false)
        expect(useModal().visible).toBe(true)
    })

    it('closes the shortcut list', () => {
        openShortcutsHelp()
        useModal().showModal(ModalOptions.login)
        expect(shortcutsHelpOpen.value).toBe(false)
    })
})
