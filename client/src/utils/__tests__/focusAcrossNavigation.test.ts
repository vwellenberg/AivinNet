import { afterEach, describe, expect, it, vi } from 'vitest'

import { focusAcrossNavigation } from '../focusAcrossNavigation'

// iOS opens the keyboard only for a focus() inside the tap itself. Tapping
// "Home" on a phone navigated to search first and focused afterwards, so the
// field had focus but no keyboard. The fix focuses a stand-in input inside the
// tap and hands the focus on once the real field is rendered.

function deferred() {
    let resolve!: () => void
    let reject!: (e: unknown) => void
    const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
    })
    return { promise, resolve, reject }
}

const standIns = () => document.querySelectorAll('[data-keyboard-stand-in]')

afterEach(() => {
    document.body.innerHTML = ''
})

describe('focusAcrossNavigation', () => {
    it('focuses an input synchronously, inside the tap, before navigation resolves', () => {
        const nav = deferred()
        void focusAcrossNavigation(
            () => nav.promise,
            () => null,
        )

        const active = document.activeElement as HTMLElement
        expect(active.tagName).toBe('INPUT')
        expect(active.hasAttribute('data-keyboard-stand-in')).toBe(true)
        nav.resolve()
    })

    it('hands the focus to the real field after navigation and removes the stand-in', async () => {
        const nav = deferred()
        const field = document.createElement('input')
        field.id = 'globalsearch'

        const pending = focusAcrossNavigation(
            () => nav.promise,
            () => document.getElementById('globalsearch'),
        )
        expect(standIns()).toHaveLength(1)

        // The field only exists once the new page has rendered.
        document.body.appendChild(field)
        nav.resolve()

        expect(await pending).toBe(true)
        expect(document.activeElement).toBe(field)
        expect(standIns()).toHaveLength(0)
    })

    it('carries what was typed into the stand-in over to the field', async () => {
        const nav = deferred()
        const field = document.createElement('input')
        field.id = 'globalsearch'
        const seen: string[] = []
        field.addEventListener('input', () => seen.push(field.value))

        const pending = focusAcrossNavigation(
            () => nav.promise,
            () => document.getElementById('globalsearch'),
        )
        // The lazy search page is still loading; the keyboard is up already.
        ;(document.activeElement as HTMLInputElement).value = 'beat'
        document.body.appendChild(field)
        nav.resolve()

        expect(await pending).toBe(true)
        expect(field.value).toBe('beat')
        expect(seen).toEqual(['beat'])
    })

    it('removes the stand-in when navigation fails', async () => {
        const nav = deferred()
        const pending = focusAcrossNavigation(
            () => nav.promise,
            () => null,
        )
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
        nav.reject(new Error('aborted'))

        expect(await pending).toBe(false)
        expect(standIns()).toHaveLength(0)
        expect(warn).toHaveBeenCalled()
        warn.mockRestore()
    })

    it('removes the stand-in when the target never appears', async () => {
        expect(
            await focusAcrossNavigation(
                () => Promise.resolve(),
                () => null,
            ),
        ).toBe(false)
        expect(standIns()).toHaveLength(0)
    })
})
