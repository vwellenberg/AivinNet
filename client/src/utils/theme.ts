/**
 * Two independent axes decide how the app looks:
 *
 *   LOOK  the form language — `memphis` (grid paper, ink frames, hard offset
 *         shadows) or `stream` (flat and dark)
 *   MODE  light or dark — the store's `theme` field, plus Auto dark mode
 *
 * They are kept apart on purpose. A single list ("Memphis / Memphis Dark /
 * Stream") mixes a design with a brightness, and falls apart the moment a
 * second look has both modes too.
 *
 * Stream is dark only. It does not overwrite the mode: the user's light/dark
 * choice (and Auto) stay stored and come back unchanged on switching back to
 * Memphis. Stream is built ON the dark classes — every component already has
 * its dark-ground answer under `body.theme-dark` — and `body.theme-stream`
 * reshapes that through the `--mem-*` colour and `--shape-*` form tokens
 * (Global/index.scss).
 */
export type Look = 'memphis' | 'stream'
export type Mode = 'light' | 'dark'

export const LOOKS: readonly Look[] = ['memphis', 'stream']

/** Looks that exist in one mode only. Mode controls are inactive under them. */
export function lookHasModes(look: Look): boolean {
    return look !== 'stream'
}

/** Which body classes are on. Every class is listed, on or off. */
export function themeBodyClasses(look: Look, mode: Mode): Record<'theme-dark' | 'theme-stream', boolean> {
    return {
        'theme-dark': mode === 'dark' || !lookHasModes(look),
        'theme-stream': look === 'stream',
    }
}
