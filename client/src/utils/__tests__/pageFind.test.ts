import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleFindShortcut, isFindShortcut, registerPageFind } from '../pageFind'

const key = (init: ConstructorParameters<typeof KeyboardEvent>[1]) => new KeyboardEvent('keydown', { key: 'f', cancelable: true, ...init })

describe('pageFind', () => {
    let unregister = () => {}
    afterEach(() => unregister())

    it('knows Cmd+F (macOS) and Ctrl+F, and nothing else', () => {
        expect(isFindShortcut(key({ metaKey: true }))).toBe(true)
        expect(isFindShortcut(key({ ctrlKey: true }))).toBe(true)
        expect(isFindShortcut(key({ ctrlKey: true, key: 'F' }))).toBe(true)
        expect(isFindShortcut(key({}))).toBe(false)
        expect(isFindShortcut(key({ metaKey: true, shiftKey: true }))).toBe(false)
        expect(isFindShortcut(key({ ctrlKey: true, altKey: true }))).toBe(false)
        expect(isFindShortcut(key({ ctrlKey: true, key: 'g' }))).toBe(false)
    })

    it('leaves the browser its find when no page has a search', () => {
        const e = key({ ctrlKey: true })
        expect(handleFindShortcut(e)).toBe(false)
        expect(e.defaultPrevented).toBe(false)
    })

    it("hands the shortcut to the page's search and keeps the browser's find closed", () => {
        const find = vi.fn(() => true)
        unregister = registerPageFind(find)

        const e = key({ metaKey: true })
        expect(handleFindShortcut(e)).toBe(true)
        expect(find).toHaveBeenCalledOnce()
        expect(e.defaultPrevented).toBe(true)
    })

    it("lets the browser's find through when the page declines", () => {
        unregister = registerPageFind(() => false)

        const e = key({ metaKey: true })
        expect(handleFindShortcut(e)).toBe(false)
        expect(e.defaultPrevented).toBe(false)
    })

    it('stops answering once the page unregisters', () => {
        const find = vi.fn(() => true)
        registerPageFind(find)()

        expect(handleFindShortcut(key({ ctrlKey: true }))).toBe(false)
        expect(find).not.toHaveBeenCalled()
    })

    it("an old page's unregister does not remove the next page's search", () => {
        const first = registerPageFind(() => true)
        unregister = registerPageFind(() => true)
        first()

        expect(handleFindShortcut(key({ ctrlKey: true }))).toBe(true)
    })
})
