import { readFileSync } from 'fs'
import { describe, expect, it } from 'vitest'

import { MIN_LIBRARY_LIST, sidebarScrollsWhole } from '@/utils/sidebarFit'

// Heights measured on the demo client, 2026-11-14, with the tighter sidebar
// spacing and 44px plates: nav 430 px (was 467), LIBRARY heading 54 px (was
// 76); the panel is the window height minus 170 px of chrome.
const NAV = 430
const HEADING = 54

describe('sidebarScrollsWhole', () => {
    it.each([
        [430, true], // 1366x600
        [480, true], // 1366x650 — the fixed parts alone overflow the panel
        [590, true], // 1440x760 — 106 px left for the playlists
        [697, false], // 1080p with bookmarks + status bar (#420) — 213 px, four rows
        [780, false], // 1920x950 — 296 px, the list keeps its own scroller
    ])('a %ipx panel scrolls whole: %s', (panel, whole) => {
        expect(sidebarScrollsWhole(panel, NAV, HEADING)).toBe(whole)
    })

    it('asks for two and a half library rows, not more', () => {
        // #420: 160 sent the user's 1080p window into the whole-panel mode,
        // which costs the active entry its reach past the frame.
        expect(MIN_LIBRARY_LIST).toBe(2 * (44 + 8) + 22)
    })

    it('counts in the row height the stylesheet draws', () => {
        // The threshold is arithmetic on $sidebar-lib-row; a row-height change
        // in SCSS alone would leave it computing with the old height.
        const vars = readFileSync('src/assets/scss/_variables.scss', 'utf8')
        const rem = vars.match(/\$sidebar-lib-row:\s*([\d.]+)rem/)
        expect(rem).not.toBeNull()
        const rowPx = Number(rem![1]) * 16
        expect(MIN_LIBRARY_LIST).toBe(2 * (rowPx + 8) + rowPx / 2)
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
