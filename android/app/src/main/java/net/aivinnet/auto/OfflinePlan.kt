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
    fun diff(snapshots: Collection<PlaylistDetail>, downloaded: Set<String>): Diff {
        val wanted = referenced(snapshots)
        return Diff(
            toDownload = wanted - downloaded,
            toRemove = downloaded - wanted,
        )
    }
}
