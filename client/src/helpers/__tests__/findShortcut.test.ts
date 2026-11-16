import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

vi.mock('@/stores/context', () => ({ default: () => ({ visible: false, hideContextMenu: vi.fn() }) }))
vi.mock('@/stores/settings', () => ({ default: () => ({ toggleDisableSidebar: vi.fn() }) }))

import useKeyboard from '../useKeyboard'
import { registerPageFind } from '@/utils/pageFind'

// Cmd/Ctrl+F in the app's own keyboard handler: the browser's find could not
// search a long playlist (virtual rows, paged loading), so a page with its own
// search takes the shortcut — and every other page must keep the browser's.
describe('Cmd/Ctrl+F in useKeyboard', () => {
    let unregister = () => {}

    beforeAll(() => {
        const queue = () => ({}) as any
        const modal = () => ({ visible: false, hideModal: vi.fn() }) as any
        useKeyboard(queue as any, modal as any)
    })
    afterEach(() => unregister())

    const press = (target: EventTarget, init: ConstructorParameters<typeof KeyboardEvent>[1]) => {
        const e = new KeyboardEvent('keydown', { key: 'f', bubbles: true, cancelable: true, ...init })
        target.dispatchEvent(e)
        return e
    }

    it('leaves Ctrl+F to the browser on a page without its own search', () => {
        // The old handler swallowed Ctrl+F everywhere for a trigger that no
        // longer existed: on Windows/Linux the browser's find never opened.
        expect(press(document.body, { ctrlKey: true }).defaultPrevented).toBe(false)
    })

    it("opens the page's search, also from inside a text field", () => {
        const find = vi.fn(() => true)
        unregister = registerPageFind(find)

        expect(press(document.body, { metaKey: true }).defaultPrevented).toBe(true)

        const input = document.createElement('input')
        document.body.append(input)
        expect(press(input, { ctrlKey: true }).defaultPrevented).toBe(true)
        input.remove()

        expect(find).toHaveBeenCalledTimes(2)
    })
})
