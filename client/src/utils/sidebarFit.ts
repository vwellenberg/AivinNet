/**
 * Whether the sidebar has to scroll as ONE piece.
 *
 * The navigation and the LIBRARY heading sit outside the scroller (#344), so
 * the active entry can reach out of the panel. On a short window they alone
 * fill it: measured 2026-10-05, 467 + 76 px against a 480-590 px panel at
 * 650-760 px window height — the playlists got about 30 px, i.e. nothing, on
 * an ordinary 1366x768 laptop. When fewer than `minList` pixels remain for
 * the list, the whole panel scrolls instead.
 *
 * Decided from the panel and the two fixed parts only, never from the list:
 * their heights do not change with the mode, so it cannot flip back and forth.
 */
export const MIN_LIBRARY_LIST = 160

export function sidebarScrollsWhole(panel: number, nav: number, heading: number, minList = MIN_LIBRARY_LIST): boolean {
    // Not laid out yet (0 or a hidden panel): keep the normal layout.
    if (!panel) return false
    return panel - nav - heading < minList
}
