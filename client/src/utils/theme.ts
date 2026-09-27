/**
 * Two independent axes decide how the app looks:
 *
 *   LOOK  the form language — `memphis` (grid paper, ink frames, hard offset
 *         shadows) or `stream` (flat and dark). Desktop 98 (#241) and
 *         Virtual Grid (#259) are parked in the tag `retro-looks-2026-09-27`
 *         (.claude/rules/styling.md, "Geparkte Looks").
 *   MODE  light or dark — the store's `theme` field, plus Auto dark mode
 *
 * They are kept apart on purpose. A single list ("Memphis / Memphis Dark /
 * Stream") mixes a design with a brightness, and falls apart the moment a
 * second look has both modes too.
 *
 * Stream is dark only, and does not overwrite the mode: the
 * user's light/dark choice (and Auto) stay stored and come back unchanged on
 * switching back to Memphis. A one-mode look is built ON that mode's classes —
 * every component already has its answer for it — and its own body class
 * reshapes that through the `--mem-*` colour and `--shape-*` / `--look-*` form
 * tokens (Global/index.scss).
 */
export type Look = 'memphis' | 'stream'
export type Mode = 'light' | 'dark'

export const LOOKS: readonly Look[] = ['memphis', 'stream']

/**
 * A stored look this build knows, or Memphis. A look written by a newer build
 * (or one that was removed) would otherwise leave the body with no look class.
 */
export function normalizeLook(look: unknown): Look {
    return LOOKS.includes(look as Look) ? (look as Look) : 'memphis'
}

/** The one mode a look is drawn in, or null when it has both. */
export function fixedMode(look: Look): Mode | null {
    return look === 'stream' ? 'dark' : null
}

/** Looks that exist in one mode only. Mode controls are inactive under them. */
export function lookHasModes(look: Look): boolean {
    return fixedMode(look) === null
}

type ThemeClass = 'theme-dark' | 'theme-stream'

/** Which body classes are on. Every class is listed, on or off. */
export function themeBodyClasses(look: Look, mode: Mode): Record<ThemeClass, boolean> {
    return {
        'theme-dark': (fixedMode(look) ?? mode) === 'dark',
        'theme-stream': look === 'stream',
    }
}
