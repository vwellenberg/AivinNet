/**
 * The interface font choice (Settings → General → Font).
 *
 * The opt-in font is named after itself, Figtree. It was stored and labelled
 * under another product's name before; no third-party brand belongs in the UI
 * or in stored settings.
 */
export type UiFont = 'default' | 'figtree'

/**
 * Map a persisted value onto a current one.
 *
 * The settings store is restored from localStorage, so a browser that picked
 * the font before the rename still holds the old value. There only ever were
 * two, so anything that is a string but not `'default'` means "the other
 * font" — without this it would match neither option: the select would show
 * nothing selected and Figtree would silently switch off. A missing or
 * non-string value falls back to the default.
 */
export function normalizeUiFont(value: unknown): UiFont {
    if (typeof value !== 'string' || value === '' || value === 'default') return 'default'
    return 'figtree'
}
