package net.aivinnet.auto

import android.content.Context
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.offline.DownloadService
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
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

    suspend fun run(): Report {
        var coverTracks: List<TrackInfo> = emptyList()
        val report = engine.syncLock.withLock { syncLocked { coverTracks = it } }
        // Outside the lock: hundreds of covers can take minutes, and "delete offline" waits on the
        // lock. The covers are only a cache; a list deleted meanwhile leaves a few unused files.
        fetchCovers(coverTracks)
        return report
    }

    private suspend fun syncLocked(coversOf: (List<TrackInfo>) -> Unit): Report = run {
        val account = api.store.accountKey ?: return@run Report(signedIn = false)
        val base = api.store.baseUrl ?: return@run Report(signedIn = false)

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
        engine.flushRatings(api)

        // Fetched after the lock is released (see run).
        coversOf(currentTracks)

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
     * Fetches the covers of [tracks] into the cover cache, so the car shows them with no network. One
     * fetch per cover: the cache name is the album's image and folder, so an album's tracks share a file.
     * A cover already cached is touched, which keeps the prune from taking the offline ones first. A
     * cover that fails is skipped; the car then shows its placeholder, as it does online. Sequential,
     * and it stops at the next cover once the sync is cancelled.
     */
    private suspend fun fetchCovers(tracks: List<TrackInfo>) {
        var failedInARow = 0
        for (cover in tracks.mapNotNull { CoverSpec.ofTrack(it.image) }.distinct()) {
            currentCoroutineContext().ensureActive()
            val outcome = CoverCache.ensure(context, api, cover, PREFETCH_DEADLINE_MS, fetchWhenUnreachable = true).outcome
            // Only failures to get a cover count: an album without art is an answer, not a failure,
            // and three of them in a row would otherwise stop every run at the same place.
            if (outcome != CoverCache.Outcome.FAILED) {
                failedInARow = 0
            } else if (++failedInARow >= PREFETCH_GIVE_UP_AFTER) {
                // The server is gone or failing: up to 15 s per cover would stretch the run for
                // minutes. The next run picks up where this one stopped (cached covers are skipped).
                offlineLog("Cover prefetch stopped after $failedInARow failures in a row", null)
                return
            }
        }
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

/** A cover of the offline sync may take longer than a car's wait; the sync is a background job. */
private const val PREFETCH_DEADLINE_MS = 15_000L

/** Consecutive failed covers after which a sync run stops fetching covers. */
private const val PREFETCH_GIVE_UP_AFTER = 3
