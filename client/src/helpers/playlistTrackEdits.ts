import { FromOptions } from '@/enums'
import { movePlaylistTrack, removeTracks } from '@/requests/playlists'
import usePlaylistStore from '@/stores/pages/playlist'
import useTracklist from '@/stores/queue/tracklist'
import { resolveMove } from '@/utils/playlistMove'
import { rangeAligns } from '@/utils/queueMove'

// ---------------------------------------------------------------------------
// The two writes the playlist page makes to its own track list — move a track,
// remove a track — in ONE place, because there are now three callers: the
// mouse drag on the song rows (views/PlaylistView/index.vue), the edit mode
// (components/PlaylistView/EditList.vue) and the track context menu. A second
// copy of either is how the paths drift, and on this list drift has already
// cost data twice (.claude/rules/playlist-writes.md).
// ---------------------------------------------------------------------------

/**
 * Move the track at `from` into drop gap `gap` (the SongItem/`resolveMove`
 * convention — see utils/playlistMove.ts), both indices into
 * `playlist.allTracks`.
 *
 * Optimistic: the list reorders at once and rolls back if the server refuses.
 * Resolves to whether the move stood.
 */
export async function movePlaylistTrackTo(from: number, gap: number): Promise<boolean> {
    const playlist = usePlaylistStore()
    const tracklist = useTracklist()

    // Resolve the move to trackhash anchors BEFORE mutating the list. Sending
    // the whole tracklist (the old behaviour) truncated the playlist to whatever
    // had been paginated in and dropped every orphan hash with it.
    const move = resolveMove(playlist.allTracks, from, gap)
    if (!move) return false

    // Is the queue playing this playlist, and do its indices still line up with
    // the ones this move is expressed in? Then the same move has to happen
    // there, or the running queue keeps playing the order the user just moved
    // away from.
    //
    // Alignment is proven over the SLICE the move touches, by trackhash, not by
    // comparing lengths: the two lists are legitimately different lengths. The
    // page paginates (a fresh visit holds ~13 of 43 rows) while the queue was
    // built from the fully fetched list — a length test rejected every mirror in
    // the normal case and only ever passed on a playlist small enough to load in
    // one page. What actually matters is that the queue agrees with the page
    // about every row between the move's two ends; if it does not (tracks added
    // to the queue, queue reordered on its own), mirroring by index would move
    // the wrong track, and we skip.
    const queueFrom = tracklist.from
    const mirrorToQueue =
        queueFrom?.type === FromOptions.playlist &&
        queueFrom.id === playlist.info.id &&
        rangeAligns(
            playlist.allTracks,
            tracklist.tracklist,
            Math.min(from, move.finalIndex),
            Math.max(from, move.finalIndex)
        )

    playlist.moveTrack(from, gap)

    const ok = await movePlaylistTrack(playlist.info.id, move.trackhash, move.beforeTrackhash)

    if (!ok) {
        // Put the row back so the list stops claiming an order the server never
        // accepted. The queue was deliberately left alone until now, so there is
        // nothing to roll back there.
        playlist.moveTrack(move.undo.from, move.undo.to)
        return false
    }

    // Mirrored only after the server agreed: rolling a queue move back is not
    // free in a group session (the mutation goes out as a broadcast and comes
    // back asynchronously), and there is no reason to risk it for an order the
    // server may reject.
    if (mirrorToQueue) tracklist.moveTrack(from, gap)
    return true
}

/**
 * Remove the track at `index` (into `playlist.allTracks`) from the playlist.
 *
 * NOT optimistic: the row goes once the server has confirmed. Resolves to
 * whether it went.
 *
 * The row is found again by REFERENCE when the answer arrives, not by the index
 * it had when the request left: in the edit mode a move can land while the
 * removal is in flight, and the old index then points at a neighbour — the
 * list would drop the wrong row while the server dropped the right one.
 */
export async function removePlaylistTrack(index: number, notify = true): Promise<boolean> {
    const playlist = usePlaylistStore()
    const track = playlist.allTracks[index]
    if (!track) return false

    const pid = playlist.info.id
    const ok = await removeTracks(pid, [{ trackhash: track.trackhash, index }], notify)
    if (!ok) return false

    const now = playlist.allTracks.indexOf(track)
    if (now !== -1) playlist.removeTrackByIndex(now)
    return true
}
