package net.aivinnet.auto

/**
 * What the car may show from the offline snapshots. Pure, so the browse fallback is testable.
 *
 * Only completely downloaded tracks are listed: a track that is not on disk cannot play in a dead
 * spot, and showing it would only produce a tap that fails.
 */
object OfflineBrowse {

    /** [snapshot] reduced to the tracks whose download is complete, in the playlist's order. */
    fun playable(snapshot: PlaylistDetail, completed: Set<String>): PlaylistDetail =
        snapshot.copy(tracks = snapshot.tracks.filter { it.trackhash in completed })

    /**
     * The offline playlists to list for a folder: synced, selected by [include], and with at least
     * one playable track. Sorted by name, so the list does not shuffle between two visits.
     */
    fun listed(
        snapshots: Map<String, PlaylistDetail?>,
        completed: Set<String>,
        include: (String) -> Boolean,
    ): List<PlaylistDetail> = snapshots
        .mapNotNull { (id, snapshot) -> snapshot?.takeIf { include(id) }?.let { playable(it, completed) } }
        .filter { it.tracks.isNotEmpty() }
        .sortedBy { it.name.lowercase() }
}
