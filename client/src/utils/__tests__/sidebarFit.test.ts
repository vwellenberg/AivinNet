import { describe, expect, it } from 'vitest'

import { MIN_LIBRARY_LIST, sidebarScrollsWhole } from '@/utils/sidebarFit'

// Heights measured on the live client, 2026-10-05: nav 467 px, LIBRARY heading
// 76 px; the panel is the window height minus 170 px of chrome.
const NAV = 467
const HEADING = 76

describe('sidebarScrollsWhole', () => {
    it.each([
        [430, true], // 1366x600
        [480, true], // 1366x650 — the fixed parts alone overflow the panel
        [590, true], // 1440x760 — 47 px left for the playlists
        [780, false], // 1920x950 — 237 px, the list keeps its own scroller
    ])('a %ipx panel scrolls whole: %s', (panel, whole) => {
        expect(sidebarScrollsWhole(panel, NAV, HEADING)).toBe(whole)
    })

    it('flips exactly where the list would get less than the minimum', () => {
        const edge = NAV + HEADING + MIN_LIBRARY_LIST
        expect(sidebarScrollsWhole(edge, NAV, HEADING)).toBe(false)
        expect(sidebarScrollsWhole(edge - 1, NAV, HEADING)).toBe(true)
    })

    it('keeps the normal layout before the panel is measured', () => {
        expect(sidebarScrollsWhole(0, NAV, HEADING)).toBe(false)
    })
})
