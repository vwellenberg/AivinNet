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
 * The minimum is two whole library rows and half of the third (rows are 44px
 * plates 8px apart): enough to work with, and the cut row says the list goes
 * on. It was 160 until #420, and that sent a plain 1080p screen into the
 * whole-panel mode once the browser had a bookmarks and a status bar
 * (measured on the user's window: 154px left for the list, which shows three
 * rows). That mode costs the active entry its reach past the frame, so it is
 * for windows that really need it, not for the most common desktop.
 *
 * Decided from the panel and the two fixed parts only, never from the list:
 * their heights do not change with the mode, so it cannot flip back and forth.
 */
const LIBRARY_ROW = 44
const LIBRARY_GAP = 8
export const MIN_LIBRARY_LIST = 2 * (LIBRARY_ROW + LIBRARY_GAP) + LIBRARY_ROW / 2

export function sidebarScrollsWhole(panel: number, nav: number, heading: number, minList = MIN_LIBRARY_LIST): boolean {
    // Not laid out yet (0 or a hidden panel): keep the normal layout.
    if (!panel) return false
    return panel - nav - heading < minList
}
