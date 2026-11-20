/**
 * The one wording for every "pin" entry: the album, music-folder, playlist and
 * playlist-folder menus and the header's pin button. The playlist menu used to
 * say a bare "Pin"/"Unpin" next to everyone else's "… library" (user,
 * 2026-11-20). Census: `utils/__tests__/pinLabel.test.ts`.
 */
export function pinLabel(pinned: boolean): string {
  return pinned ? "Unpin from library" : "Pin to library";
}
