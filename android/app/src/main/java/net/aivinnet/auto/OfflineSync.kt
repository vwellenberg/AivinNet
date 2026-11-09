package net.aivinnet.auto

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadService
import java.io.IOException
import kotlinx.coroutines.sync.withLock

/**
 * Brings the offline playlists up to date and makes the disk match them.
 *
 * Each offline playlist is fetched fresh and its snapshot replaced. A failed fetch keeps the old
 * snapshot, so a dead spot during a sync costs nothing. Then downloads are started and removed to
 * match all snapshots of all accounts (see [OfflinePlan]). Finally the scrobble outbox is flushed.
 */
@UnstableApi
class OfflineSync(
    private val context: Context,
    private val api: AivinApi,
    private val engine: OfflineEngine,
) {

    data class Report(
        val signedIn: Boolean,
        val refreshed: Int = 0,
        val failed: Int = 0,
        val queued: Int = 0,
        val removed: Int = 0,
    )

    suspend fun run(): Report = engine.syncLock.withLock {
        val account = api.store.accountKey ?: return@withLock Report(signedIn = false)
        val base = api.store.baseUrl ?: return@withLock Report(signedIn = false)

        var refreshed = 0
        var failed = 0
        for (id in engine.store.load().offlineIds(account)) {
            val previous = engine.store.load().snapshots(account)[id]
            try {
                // A 404 means the playlist (or this mix) is gone: an empty snapshot, the id stays offline.
                val fresh = api.playlist(id) ?: PlaylistDetail(id, previous?.name ?: id, emptyList())
                engine.store.update { it.withSnapshot(account, id, fresh) }
                refreshed++
            } catch (e: IOException) {
                offlineLog("Sync of playlist $id failed, keeping its last snapshot", e)
                failed++
            }
        }

        val state = engine.store.load()
        val diff = OfflinePlan.diff(state.allSnapshots(), engine.heldTrackhashes())

        // Only this account's tracks can be fetched now: they need this server and this login.
        // Another account's offline tracks stay as they are until that account syncs again.
        val currentTracks = state.snapshots(account).values.filterNotNull().flatMap { it.tracks }
        val byHash = currentTracks.associateBy { it.trackhash }
        var queued = 0
        for (hash in diff.toDownload) {
            val track = byHash[hash] ?: continue
            val request = OfflineEngine.request(hash, StreamUrls.build(base, hash, track.filepath))
            DownloadService.sendAddDownload(context, OfflineDownloadService::class.java, request, false)
            queued++
        }
        for (hash in diff.toRemove) {
            DownloadService.sendRemoveDownload(context, OfflineDownloadService::class.java, hash, false)
        }

        engine.flushScrobbles(api)

        Report(
            signedIn = true,
            refreshed = refreshed,
            failed = failed,
            queued = queued,
            removed = diff.toRemove.size,
        )
    }
}
