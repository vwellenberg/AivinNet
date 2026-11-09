package net.aivinnet.auto

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

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
        /**
         * The download service could not be started (the app is in the background) and the
         * manager got the work directly: the caller must keep the process alive until it is idle.
         */
        val needsKeepAlive: Boolean = false,
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
        val diff = OfflinePlan.diff(state.allSnapshots(), engine.heldTrackhashes(), engine.failedTrackhashes())

        // Only this account's tracks can be fetched now: they need this server and this login.
        // Another account's offline tracks stay as they are until that account syncs again.
        val currentTracks = state.snapshots(account).values.filterNotNull().flatMap { it.tracks }
        val byHash = currentTracks.associateBy { it.trackhash }
        val adds = diff.toDownload.mapNotNull { hash ->
            byHash[hash]?.let { OfflineEngine.request(hash, StreamUrls.build(base, hash, it.filepath)) }
        }
        val direct = submit(adds, diff.toRemove)

        engine.flushScrobbles(api)

        Report(
            signedIn = true,
            refreshed = refreshed,
            failed = failed,
            queued = adds.size,
            removed = diff.toRemove.size,
            needsKeepAlive = direct && adds.isNotEmpty(),
        )
    }

    /**
     * Hands the changes to the download service, or straight to the manager when Android refuses
     * the service start. Returns true for the direct path.
     *
     * ⚠️ `sendAddDownload(…, foreground = false)` is a plain `startService`, which Android 8+
     * refuses with an IllegalStateException while the app is in the background — exactly where the
     * periodic worker runs. Without this fallback the 12-hour sync never downloaded anything. The
     * direct path calls the manager on the main thread, the looper it was created on (it has none of
     * its own); additions and removals are idempotent, so a partly sent intent batch is harmless.
     */
    private suspend fun submit(adds: List<DownloadRequest>, removes: Collection<String>): Boolean {
        try {
            for (request in adds) {
                DownloadService.sendAddDownload(context, OfflineDownloadService::class.java, request, false)
            }
            for (hash in removes) {
                DownloadService.sendRemoveDownload(context, OfflineDownloadService::class.java, hash, false)
            }
            return false
        } catch (e: IllegalStateException) {
            offlineLog("Download service not startable in the background, using the manager directly", e)
        }
        val allowMobile = engine.store.load().allowMobile
        withContext(Dispatchers.Main) {
            val manager = engine.downloads
            manager.setRequirements(OfflineEngine.requirementsFor(allowMobile))
            adds.forEach { manager.addDownload(it) }
            removes.forEach { manager.removeDownload(it) }
        }
        return true
    }
}
