/**
 * The card type vocabulary — shared by `CardTypeLabel.vue` (which draws the
 * label) and by the tiles (which decide whether their help text still says
 * anything the label has not already said).
 */
export type CardType = 'album' | 'artist' | 'folder' | 'playlist' | 'track'

export const CARD_TYPE_LABELS: Record<CardType, string> = {
    album: 'Album',
    artist: 'Artist',
    folder: 'Folder',
    playlist: 'Playlist',
    track: 'Track',
}

/**
 * True when a tile's `help_text` is just its type spelled out again.
 *
 * The backend uses that field for two different jobs: on "Recently played" it
 * is the type ("ALBUM", "TRACK"), on "Top artists this week" it is real
 * information ("52 MINS", "167 TRACKS"). Since the type now has its own label
 * above the artwork, the first kind would print the same word twice on one
 * tile — measured on the running app, not assumed.
 */
export function isTypeEcho(help: string | undefined, type: CardType): boolean {
    return !!help && help.trim().toLowerCase() === CARD_TYPE_LABELS[type].toLowerCase()
}
