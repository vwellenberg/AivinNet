import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/context', () => ({ default: () => ({ visible: false, hideContextMenu: vi.fn() }) }))
vi.mock('@/stores/settings', () => ({ default: () => ({ toggleDisableSidebar: vi.fn() }) }))

import useKeyboard from '../useKeyboard'
import { open } from '@/stores/quickPlay'

// Ctrl/Cmd+P opens quick play from the app's global keyboard handler, also from a
// text field, and suppresses the browser's print dialog. Shift+P is a different key.
describe('Ctrl/Cmd+P quick play in useKeyboard', () => {
    const modalState = { visible: false, hideModal: vi.fn() }

    beforeAll(() => {
        const queue = () => ({}) as any
        const modal = () => modalState as any
        useKeyboard(queue as any, modal as any)
    })
    afterEach(() => {
        open.value = false
        modalState.visible = false
    })

    const press = (
        target: EventTarget,
        init: { ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean; key?: string; code?: string }
    ) => {
        const e = new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(e)
        return e
    }

    it('Ctrl+P opens quick play and suppresses the browser default', () => {
        const e = press(document.body, { ctrlKey: true })
        expect(e.defaultPrevented).toBe(true)
        expect(open.value).toBe(true)
    })

    it('Cmd+P opens quick play too', () => {
        const e = press(document.body, { metaKey: true })
        expect(e.defaultPrevented).toBe(true)
        expect(open.value).toBe(true)
    })

    it('opens it also while a text field has focus', () => {
        const input = document.createElement('input')
        document.body.append(input)
        const e = press(input, { ctrlKey: true })
        input.remove()
        expect(e.defaultPrevented).toBe(true)
        expect(open.value).toBe(true)
    })

    it('does not open over a modal, and still keeps the print dialog away', () => {
        // The login modal after a 401: the box would sit on top of the form.
        modalState.visible = true
        const e = press(document.body, { ctrlKey: true })
        expect(e.defaultPrevented).toBe(true)
        expect(open.value).toBe(false)
    })

    it('works on a non-Latin layout, where `key` is the local letter', () => {
        const e = press(document.body, { ctrlKey: true, key: 'з', code: 'KeyP' })
        expect(e.defaultPrevented).toBe(true)
        expect(open.value).toBe(true)
    })

    it('Ctrl+Shift+P is not quick play', () => {
        const e = press(document.body, { ctrlKey: true, shiftKey: true })
        expect(e.defaultPrevented).toBe(false)
        expect(open.value).toBe(false)
    })
})
