package net.aivinnet.auto

import android.content.Context
import android.util.Log
import androidx.core.net.toUri
import androidx.media3.common.util.UnstableApi
import androidx.media3.database.StandaloneDatabaseProvider
import androidx.media3.datasource.cache.NoOpCacheEvictor
import androidx.media3.datasource.cache.SimpleCache
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadCursor
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadRequest
import androidx.media3.exoplayer.scheduler.PlatformScheduler
import androidx.media3.exoplayer.scheduler.Requirements
import java.io.File
import java.util.concurrent.Executors
import kotlinx.coroutines.sync.Mutex

/**
 * The offline stack of the process: the one [SimpleCache], the [DownloadManager], the offline state
 * and the scrobble outbox. The playback service, the download service, the sync worker and the
 * activity all share this one instance.
 *
 * Why a singleton: a SimpleCache locks its folder for the whole process, so a second instance would
 * throw, and two DownloadManagers would fight over one download index.
 */
@UnstableApi
class OfflineEngine private constructor(context: Context) {

    /** Every downloaded track, keyed by trackhash. Never evicted: a download must not vanish in the car. */
    val cache: SimpleCache

    /**
     * The one manager. Its methods are not documented as thread-safe, so the rest of the app talks to
     * it through [OfflineDownloadService] intents, and only the service calls it directly.
     */
    val downloads: DownloadManager

    val store: OfflineStore
    val scrobbles: ScrobbleOutbox

    /** One sync at a time: the worker, the activity and the manual button can all start one. */
    val syncLock = Mutex()

    init {
        val databaseProvider = StandaloneDatabaseProvider(context)
        cache = SimpleCache(File(context.filesDir, CACHE_DIR), NoOpCacheEvictor(), databaseProvider)

        // Same bearer and refresh logic as the API: a download refreshes the token like playback does.
        val upstream = OkHttpDataSource.Factory(AivinApi.create(context).authedClient)
        val executor = Executors.newFixedThreadPool(MAX_PARALLEL_DOWNLOADS) { runnable ->
            Thread(runnable, "offline-download").apply { isDaemon = true }
        }
        downloads = DownloadManager(context, databaseProvider, cache, upstream, executor)

        store = OfflineStore(File(context.filesDir, STORE_FILE), ::offlineLog)
        scrobbles = ScrobbleOutbox(
            JsonFile<List<QueuedPlay>>(
                File(context.filesDir, SCROBBLE_QUEUE_FILE),
                emptyList(),
                OfflineJson::decodeQueue,
                OfflineJson::encodeQueue,
                ::offlineLog,
            ),
            ::offlineLog,
        )
    }

    /**
     * Trackhashes with a download that is queued, running, paused or done. Failed ones are not held,
     * so the next sync queues them again.
     */
    fun heldTrackhashes(): Set<String> = trackhashes(
        downloads.downloadIndex.getDownloads(
            Download.STATE_QUEUED,
            Download.STATE_STOPPED,
            Download.STATE_DOWNLOADING,
            Download.STATE_COMPLETED,
            Download.STATE_RESTARTING,
        ),
    )

    fun failedTrackhashes(): Set<String> =
        trackhashes(downloads.downloadIndex.getDownloads(Download.STATE_FAILED))

    fun completedTrackhashes(): Set<String> =
        trackhashes(downloads.downloadIndex.getDownloads(Download.STATE_COMPLETED))

    /** Bytes on disk for the completed downloads: the number the phone screen shows. */
    fun storageBytes(): Long = downloads.downloadIndex.getDownloads(Download.STATE_COMPLETED).use { cursor ->
        var total = 0L
        while (cursor.moveToNext()) total += cursor.download.bytesDownloaded
        total
    }

    private fun trackhashes(cursor: DownloadCursor): Set<String> = cursor.use {
        val out = HashSet<String>()
        while (it.moveToNext()) out += it.download.request.id
        out
    }

    /** Sends [play] now. If the server cannot take it, it waits in the outbox for the next flush. */
    suspend fun recordScrobble(api: AivinApi, play: ScrobblePlay) {
        val owner = api.store.accountKey ?: return
        scrobbles.record(owner, play) { sendScrobble(it, api::logPlay, ::offlineLog) }
    }

    /** Sends the plays waiting for the signed-in account, oldest first. */
    suspend fun flushScrobbles(api: AivinApi) {
        val owner = api.store.accountKey ?: return
        scrobbles.flush(owner) { sendScrobble(it, api::logPlay, ::offlineLog) }
    }

    companion object {
        private const val CACHE_DIR = "media"
        private const val STORE_FILE = "offline.json"
        private const val SCROBBLE_QUEUE_FILE = "scrobble-queue.json"
        private const val MAX_PARALLEL_DOWNLOADS = 3

        /** Used by [PlatformScheduler] for the job that restarts downloads when requirements are met again. */
        // ⚠️ Far from 0: WorkManager hands out JobScheduler ids counting up from 0 and would reach a
        // small id, after which the two jobs replace each other (the download resume job vanishes).
        const val SCHEDULER_JOB_ID = 2_000_000_747

        @Volatile
        private var instance: OfflineEngine? = null

        /** The process's engine, created on first use from any thread. */
        fun get(context: Context): OfflineEngine = instance ?: synchronized(this) {
            instance ?: OfflineEngine(context.applicationContext).also { instance = it }
        }

        /** The download request for one track. The trackhash is the id and the cache key, so the filepath never matters. */
        fun request(trackhash: String, streamUrl: String): DownloadRequest =
            DownloadRequest.Builder(trackhash, streamUrl.toUri())
                .setCustomCacheKey(trackhash)
                .build()

        /** Unmetered Wi-Fi by default; mobile data only when the user allows it. */
        fun requirementsFor(allowMobile: Boolean): Requirements =
            Requirements(if (allowMobile) Requirements.NETWORK else Requirements.NETWORK_UNMETERED)

        fun scheduler(context: Context): PlatformScheduler = PlatformScheduler(context, SCHEDULER_JOB_ID)
    }
}

private const val OFFLINE_TAG = "Offline"

/** Non-fatal offline problems go to logcat; nothing in the offline path may crash the app or the service. */
internal fun offlineLog(message: String, cause: Throwable?) {
    Log.w(OFFLINE_TAG, message, cause)
}
