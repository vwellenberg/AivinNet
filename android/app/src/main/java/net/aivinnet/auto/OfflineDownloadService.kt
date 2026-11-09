package net.aivinnet.auto

import android.app.Notification
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.offline.Download
import androidx.media3.exoplayer.offline.DownloadManager
import androidx.media3.exoplayer.offline.DownloadNotificationHelper
import androidx.media3.exoplayer.offline.DownloadService
import androidx.media3.exoplayer.scheduler.Scheduler

/**
 * Downloads the tracks of the offline playlists into the engine's cache.
 *
 * It runs as a `dataSync` foreground service with a progress notification while transfers are
 * active. When the requirements (unmetered network by default) are not met, the [OfflineEngine.scheduler]
 * job resumes the queue later, so downloads do not wait for the app to be opened.
 */
@UnstableApi
class OfflineDownloadService : DownloadService(
    FOREGROUND_NOTIFICATION_ID,
    DEFAULT_FOREGROUND_NOTIFICATION_UPDATE_INTERVAL,
    CHANNEL_ID,
    R.string.offline_channel_name,
    R.string.offline_channel_description,
) {

    /**
     * Called once when the service starts. The requirements are applied here, on the service's main
     * thread, because the DownloadManager is not documented as thread-safe. They come from the
     * stored switch, so a restart keeps the user's "mobile data" choice.
     */
    override fun getDownloadManager(): DownloadManager {
        val engine = OfflineEngine.get(this)
        val allowMobile = engine.store.load().allowMobile
        return engine.downloads.also { it.setRequirements(OfflineEngine.requirementsFor(allowMobile)) }
    }

    override fun getScheduler(): Scheduler? = OfflineEngine.scheduler(this)

    override fun getForegroundNotification(downloads: MutableList<Download>, notMetRequirements: Int): Notification =
        DownloadNotificationHelper(this, CHANNEL_ID).buildProgressNotification(
            this,
            android.R.drawable.stat_sys_download,
            /* contentIntent = */ null,
            /* message = */ null,
            downloads,
            notMetRequirements,
        )

    companion object {
        private const val FOREGROUND_NOTIFICATION_ID = 747
        private const val CHANNEL_ID = "offline_downloads"
    }
}
