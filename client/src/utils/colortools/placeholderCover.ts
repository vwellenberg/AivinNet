/**
 * Is this image URL the server's placeholder rather than real artwork?
 *
 * The placeholders (src/aivinnet/assets/default|track|artist.webp) are an ink
 * glyph on a TRANSPARENT tile since #395; the tile colour comes from the page
 * (Global/cover-placeholders.scss), so it follows the colour scheme. Read as a
 * cover, node-vibrant skips the clear pixels and finds only the glyph — a
 * near-black page gradient behind every album without artwork.
 *
 * The pixels cannot tell: real covers and artist cut-outs keep their alpha
 * channel as well, so "the corner is clear" would also catch a PNG with
 * rounded corners. The server says it instead — every placeholder response
 * carries `X-Aivinnet-Placeholder` (api/imgserver.py). A HEAD request reads
 * it without the image.
 *
 * Resolves false when the answer cannot be read (network error, the header
 * not exposed to another origin): then the image is treated as a cover,
 * exactly as before this check existed.
 */
export const PLACEHOLDER_HEADER = 'X-Aivinnet-Placeholder'

export async function coverIsPlaceholder(url: string): Promise<boolean> {
    try {
        const res = await fetch(url, { method: 'HEAD' })
        return res.ok && res.headers.get(PLACEHOLDER_HEADER) !== null
    } catch {
        return false
    }
}
