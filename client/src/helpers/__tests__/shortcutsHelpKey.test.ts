import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/context', () => ({ default: () => ({ visible: false, hideContextMenu: vi.fn() }) }))
vi.mock('@/stores/settings', () => ({ default: () => ({ toggleDisableSidebar: vi.fn() }) }))

import useKeyboard from '../useKeyboard'
import { shortcutsHelpOpen } from '@/stores/shortcutsHelp'
import { open as quickPlayOpen } from '@/stores/quickPlay'
import { registerPageFind } from '@/utils/pageFind'

// "?" opens the shortcut overlay from the global keyboard handler. It is Shift+/ on
// a US layout and Shift+ß on a German one, so Shift is not refused; Ctrl, Cmd and
// Alt are. It does nothing while typing or while a modal is up.
describe('? opens the shortcut overlay', () => {
    const modalState = { visible: false, hideModal: vi.fn() }
    const playPause = vi.fn()

    beforeAll(() => {
        const queue = () => ({ playPause, seek: vi.fn(), playNext: vi.fn(), playPrev: vi.fn() }) as any
        const modal = () => modalState as any
        useKeyboard(queue as any, modal as any)
    })

    afterEach(() => {
        shortcutsHelpOpen.value = false
        quickPlayOpen.value = false
        modalState.visible = false
        playPause.mockClear()
        document.body.innerHTML = ''
    })

    // keyup resets the handler's repeat guard, as it does on a real keyboard.
    function press(target: EventTarget, init: { key?: string; shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }) {
        const e = new KeyboardEvent('keydown', { key: '?', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(e)
        window.dispatchEvent(new KeyboardEvent('keyup', { key: init.key ?? '?' }))
        return e
    }

    it('opens with Shift held, as on a US layout', () => {
        press(document.body, { key: '?', shiftKey: true })
        expect(shortcutsHelpOpen.value).toBe(true)
    })

    it('opens without Shift, as on a layout where ? is a plain key', () => {
        press(document.body, { key: '?', shiftKey: false })
        expect(shortcutsHelpOpen.value).toBe(true)
    })

    it('is not taken with Ctrl, Cmd or Alt', () => {
        press(document.body, { key: '?', ctrlKey: true })
        press(document.body, { key: '?', metaKey: true })
        press(document.body, { key: '?', altKey: true })
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('does not open while typing in a text field', () => {
        const input = document.createElement('input')
        document.body.appendChild(input)
        input.focus()
        press(input, { key: '?', shiftKey: true })
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('does not open over a visible modal', () => {
        modalState.visible = true
        press(document.body, { key: '?', shiftKey: true })
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('a second ? closes it again', () => {
        press(document.body, { key: '?', shiftKey: true })
        press(document.body, { key: '?', shiftKey: true })
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('Escape closes it', () => {
        press(document.body, { key: '?', shiftKey: true })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
        expect(shortcutsHelpOpen.value).toBe(false)
    })

    it('while it is open, Space does not play behind it', () => {
        press(document.body, { key: '?', shiftKey: true })
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
        expect(playPause).not.toHaveBeenCalled()
        expect(shortcutsHelpOpen.value).toBe(true)
    })

    it('with it closed, Space still plays', () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }))
        expect(playPause).toHaveBeenCalledTimes(1)
    })

    it('Ctrl/Cmd+P does not open quick play over the overlay', () => {
        press(document.body, { key: '?', shiftKey: true })
        window.dispatchEvent(
            new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, bubbles: true, cancelable: true })
        )
        expect(quickPlayOpen.value).toBe(false)
    })

    it('Cmd/Ctrl+F does not open the page search behind the open list', () => {
        // The page's search field took focus under the overlay, and typing then
        // filtered a list nobody could see.
        const find = vi.fn(() => true)
        const unregister = registerPageFind(find)
        try {
            shortcutsHelpOpen.value = true
            press(document.body, { key: 'f', ctrlKey: true })
            press(document.body, { key: 'f', metaKey: true })
            expect(find).not.toHaveBeenCalled()

            shortcutsHelpOpen.value = false
            press(document.body, { key: 'f', ctrlKey: true })
            expect(find).toHaveBeenCalledTimes(1)
        } finally {
            unregister()
        }
    })
})
