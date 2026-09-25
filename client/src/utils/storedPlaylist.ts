/**
 * Whether a playlist id names a STORED playlist — one the user made, whose
 * order and contents are theirs to change. The playlist page also serves
 * lists the server generates ("recentlyadded", "recentlyplayed"): no
 * "Date added" column there, no edit mode, no "Remove from playlist".
 *
 * One test for every caller. They used to disagree: the page matched
 * `/^\d+$/` while the track menu asked `parseInt()`, which also accepts an id
 * that merely STARTS with digits.
 */
export function isStoredPlaylistId(id: unknown): boolean {
    return /^\d+$/.test(String(id ?? ''))
}
