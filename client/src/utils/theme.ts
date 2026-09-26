/**
 * Two independent axes decide how the app looks:
 *
 *   LOOK  the form language — `memphis` (grid paper, ink frames, hard offset
 *         shadows), `stream` (flat and dark) or `desktop98` (grey bevelled
 *         windows on a desktop-blue ground, #241)
 *   MODE  light or dark — the store's `theme` field, plus Auto dark mode
 *
 * They are kept apart on purpose. A single list ("Memphis / Memphis Dark /
 * Stream") mixes a design with a brightness, and falls apart the moment a
 * second look has both modes too.
 *
 * Stream is dark only, Desktop 98 light only. Neither overwrites the mode: the
 * user's light/dark choice (and Auto) stay stored and come back unchanged on
 * switching back to Memphis. A one-mode look is built ON that mode's classes —
 * every component already has its answer for it — and its own body class
 * reshapes that through the `--mem-*` colour and `--shape-*` / `--look-*` form
 * tokens (Global/index.scss).
 */
export type Look = 'memphis' | 'stream' | 'desktop98'
export type Mode = 'light' | 'dark'

export const LOOKS: readonly Look[] = ['memphis', 'stream', 'desktop98']

/**
 * A stored look this build knows, or Memphis. A look written by a newer build
 * (or one that was removed) would otherwise leave the body with no look class.
 */
export function normalizeLook(look: unknown): Look {
    return LOOKS.includes(look as Look) ? (look as Look) : 'memphis'
}

/** The one mode a look is drawn in, or null when it has both. */
export function fixedMode(look: Look): Mode | null {
    if (look === 'stream') return 'dark'
    if (look === 'desktop98') return 'light'
    return null
}

/** Looks that exist in one mode only. Mode controls are inactive under them. */
export function lookHasModes(look: Look): boolean {
    return fixedMode(look) === null
}

type ThemeClass = 'theme-dark' | 'theme-stream' | 'theme-desktop98'

/** Which body classes are on. Every class is listed, on or off. */
export function themeBodyClasses(look: Look, mode: Mode): Record<ThemeClass, boolean> {
    return {
        'theme-dark': (fixedMode(look) ?? mode) === 'dark',
        'theme-stream': look === 'stream',
        'theme-desktop98': look === 'desktop98',
    }
}
