package net.aivinnet.auto

/**
 * Which tracks have to be downloaded and which may be removed. Pure, so the rule that protects a
 * track still used by another offline playlist is testable without a device.
 */
object OfflinePlan {

    data class Diff(val toDownload: Set<String>, val toRemove: Set<String>)

    /** Every trackhash that an offline snapshot still lists. */
    fun referenced(snapshots: Collection<PlaylistDetail>): Set<String> =
        snapshots.flatMapTo(HashSet()) { snapshot -> snapshot.tracks.map { it.trackhash } }

    /**
     * [snapshots] are the snapshots of *all* offline playlists, of every account: a track is only
     * removed when no offline playlist anywhere still lists it. [downloaded] are the trackhashes
     * with a live download (failed ones do not count, so they are queued again).
     */
    /**
     * @param failed downloads that failed. A wanted one is queued again (it is not in [downloaded]);
     *   an unwanted one is removed — the cache never evicts, so its partial bytes would otherwise
     *   stay on disk for good, invisible to the storage line that only counts completed downloads.
     */
    fun diff(
        snapshots: Collection<PlaylistDetail>,
        downloaded: Set<String>,
        failed: Set<String> = emptySet(),
    ): Diff {
        val wanted = referenced(snapshots)
        return Diff(
            toDownload = wanted - downloaded,
            toRemove = (downloaded + failed) - wanted,
        )
    }
}
