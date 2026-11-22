import { describe, expect, it } from 'vitest'

// The shortcut list (utils/shortcuts.ts) must not drift from the handlers that
// answer the keys. These tests read each handler's source and compare the keys it
// matches with the entries listed for that file. A key added to a handler but not
// listed, or listed but no longer handled, fails here.
//
// A parser that finds nothing would pass silently, so every parse is guarded by
// keys it must find.

import useKeyboardSource from '../useKeyboard?raw'
import pageFindSource from '@/utils/pageFind.ts?raw'
import quickPlaySource from '@/stores/quickPlay.ts?raw'
import quickPlayBoxSource from '@/components/QuickPlay.vue?raw'
import appSource from '@/App.vue?raw'
import { SHORTCUTS } from '@/utils/shortcuts'

const lower = (s: string) => s.toLowerCase()

/** Keys the global handler switches on or compares: `case "x":` and `e.key == "x"`. */
function globalHandlerKeys(src: string): string[] {
    const found = new Set<string>()
    for (const m of src.matchAll(/case\s+(["'])(.*?)\1\s*:/g)) found.add(lower(m[2]))
    for (const m of src.matchAll(/e\.key\s*[!=]==?\s*(["'])(.*?)\1/g)) found.add(lower(m[2]))
    return [...found].sort()
}

/** Case labels only: the box's own `switch (e.key)`, not its `if (e.key === 'Tab')`. */
function switchKeys(src: string): string[] {
    const found = new Set<string>()
    for (const m of src.matchAll(/case\s+(["'])(.*?)\1\s*:/g)) found.add(lower(m[2]))
    return [...found].sort()
}

/** The key a file's `toLowerCase() === '…'` check matches (pageFind: f, quickPlay: p). */
function singleLetterKeys(src: string): string[] {
    const found = new Set<string>()
    for (const m of src.matchAll(/toLowerCase\(\)\s*===\s*(["'])(\w)\1/g)) found.add(lower(m[2]))
    return [...found].sort()
}

function listedFor(file: string): string[] {
    return SHORTCUTS.filter(s => s.handledIn === file)
        .flatMap(s => s.handlerKeys.map(lower))
        .sort()
}

function sameKeys(actual: string[], expected: string[]) {
    expect([...new Set(actual)].sort()).toEqual([...new Set(expected)].sort())
}

describe('shortcut list census', () => {
    it('useKeyboard.ts: every key it handles is listed, and every listed key is handled', () => {
        const handled = globalHandlerKeys(useKeyboardSource)
        // Guard: the parser found the keys it must find, not an empty set.
        expect(handled.length).toBeGreaterThanOrEqual(6)
        expect(handled).toEqual(expect.arrayContaining(['arrowleft', 'arrowright', ' ', 'b', 'escape', '?']))
        sameKeys(listedFor('useKeyboard'), handled)
    })

    it('pageFind.ts: the list find key is the one listed', () => {
        const keys = singleLetterKeys(pageFindSource)
        expect(keys).toEqual(['f'])
        sameKeys(listedFor('pageFind'), keys)
    })

    it('quickPlay.ts: the quick play key is the one listed', () => {
        const keys = singleLetterKeys(quickPlaySource)
        expect(keys).toEqual(['p'])
        sameKeys(listedFor('quickPlay'), keys)
    })

    it('QuickPlay.vue: the keys of the box are the ones listed', () => {
        const keys = switchKeys(quickPlayBoxSource)
        expect(keys).toEqual(expect.arrayContaining(['arrowdown', 'arrowup', 'enter', 'escape']))
        sameKeys(listedFor('QuickPlay.vue'), keys)
    })

    it('App.vue: typing to search is listed, and the handler is still there', () => {
        // Typing-to-search has no key of its own to parse (any printable key), so the
        // census checks that the entry exists and that App.vue still wires it up.
        expect(listedFor('App.vue')).toEqual([])
        expect(SHORTCUTS.filter(s => s.handledIn === 'App.vue')).toHaveLength(1)
        expect(appSource).toMatch(/onStartTyping\(/)
    })
})
