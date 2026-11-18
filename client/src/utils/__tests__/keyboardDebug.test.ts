import { afterEach, describe as group, expect, it } from 'vitest'

import { describe, installKeyboardDebug, keyboardDebugWanted } from '@/utils/keyboardDebug'

// The on-device keyboard log (temporary) must stay off for everyone who does
// not ask for it with `kbdebug` in the address.
group('keyboardDebug', () => {
    afterEach(() => {
        document.querySelectorAll('[data-kbdebug]').forEach(el => el.remove())
        sessionStorage.clear()
    })

    it('is wanted only with the flag in the address or the session', () => {
        expect(keyboardDebugWanted('https://music.example/#/search/top', null)).toBe(false)
        expect(keyboardDebugWanted('https://music.example/?kbdebug#/search/top', null)).toBe(true)
        expect(keyboardDebugWanted('https://music.example/#/search/top', '1')).toBe(true)
    })

    it('adds nothing to the page without the flag', () => {
        installKeyboardDebug()
        expect(document.querySelector('[data-kbdebug]')).toBeNull()
    })

    it('names targets the way the log shows them', () => {
        const field = document.createElement('input')
        field.id = 'globalsearch'
        const pill = document.createElement('div')
        pill.className = 'gsearch-input wide'
        expect(describe(field)).toBe('#globalsearch')
        expect(describe(pill)).toBe('div.gsearch-input')
        expect(describe(null)).toBe('null')
    })
})
