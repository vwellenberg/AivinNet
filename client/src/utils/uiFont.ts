/**
 * The interface font choice (Settings → General → Font).
 *
 * The opt-in font is named after itself, Figtree, not after another product:
 * this used to be `'spotify'`, labelled "Spotify style", and no third-party
 * brand belongs in the UI or in stored settings.
 */
export type UiFont = 'default' | 'figtree'

/**
 * Map a persisted value onto a current one.
 *
 * The settings store is restored from localStorage, so a browser that picked
 * the font before the rename still holds `'spotify'`. Without this it would
 * match neither option: the select would show nothing selected and Figtree
 * would silently switch off. Anything unknown falls back to the default.
 */
export function normalizeUiFont(value: unknown): UiFont {
    if (value === 'figtree' || value === 'spotify') return 'figtree'
    return 'default'
}
