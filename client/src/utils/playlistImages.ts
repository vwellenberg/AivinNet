/**
 * Helpers for playlist thumbnail rendering (single cover vs 2x2 collage).
 *
 * The backend sends `playlist.images` as the covers of the first albums in
 * the playlist, deduplicated (by albumhash and by cover file content) and
 * padded with duplicates when fewer than 4 distinct covers exist. Entries are
 * `{ image, color }` dicts on most endpoints, plain filename strings on a few.
 */

export type PlaylistImageEntry = { image: string; color?: string } | string

export function imageName(entry: PlaylistImageEntry): string {
    return typeof entry === 'string' ? entry : entry.image
}

/**
 * Returns the first 4 image filenames when the playlist has 4 pairwise
 * different covers (collage-worthy), else null.
 *
 * Padded backend results (e.g. [a, b, b, a] for a 2-album playlist) fail the
 * distinctness check by design, so callers fall back to the single cover.
 */
export function getCollageImages(images: PlaylistImageEntry[] | undefined | null): string[] | null {
    if (!images || images.length < 4) return null

    const first4 = images.slice(0, 4).map(imageName)

    if (first4.some(name => !name)) return null

    return new Set(first4).size === 4 ? first4 : null
}
