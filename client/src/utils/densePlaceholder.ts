/**
 * Asks the image server for the DENSE placeholder cut (`ph=dense`) in case the
 * cover is missing. Only for the sidebar's 28px slots: the regular placeholder
 * draws its glyph at a quarter of the tile, which there came out as a 6px
 * record with 0.8px lines next to icons at 1.8px (user, 2026-11-16). A real
 * cover ignores the parameter.
 *
 * Image names may already carry a query (`<hash>.webp?pathhash=…&fb=track`).
 */
export function densePlaceholder(url: string): string {
    if (!url) return url
    return url + (url.includes('?') ? '&' : '?') + 'ph=dense'
}
