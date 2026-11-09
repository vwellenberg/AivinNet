package net.aivinnet.auto

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Runs [OfflineSync] in the background, every 12 hours and when the user asks for it. */
class OfflineSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {

    override suspend fun doWork(): Result {
        val api = AivinApi.create(applicationContext)
        if (!api.isLoggedIn) return Result.success()
        return try {
            OfflineSync(applicationContext, api, OfflineEngine.get(applicationContext)).run()
            Result.success()
        } catch (e: IOException) {
            // The next attempt comes with WorkManager's backoff, not in a tight loop.
            Result.retry()
        }
    }
}

/** The two schedules of the sync: the periodic cycle and the one-off run after a change. */
object OfflineScheduling {
    private const val PERIODIC_NAME = "offline-sync-periodic"
    private const val NOW_NAME = "offline-sync-now"

    /**
     * Unmetered network unless the user allowed mobile data. Both schedules take their constraints
     * from the same switch.
     */
    fun constraints(allowMobile: Boolean): Constraints = Constraints.Builder()
        .setRequiredNetworkType(if (allowMobile) NetworkType.CONNECTED else NetworkType.UNMETERED)
        .build()

    /**
     * UPDATE, not KEEP: KEEP would keep the old constraints, so flipping the mobile-data switch
     * would never reach the periodic work.
     */
    fun schedulePeriodic(context: Context, allowMobile: Boolean) {
        val request = PeriodicWorkRequestBuilder<OfflineSyncWorker>(12, TimeUnit.HOURS)
            .setConstraints(constraints(allowMobile))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniquePeriodicWork(PERIODIC_NAME, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /**
     * REPLACE: a change made while a sync is already running must be picked up, and the running one
     * may have read the state before the change. Syncs are idempotent, so the restart costs little.
     */
    fun syncNow(context: Context, allowMobile: Boolean) {
        val request = OneTimeWorkRequestBuilder<OfflineSyncWorker>()
            .setConstraints(constraints(allowMobile))
            .build()
        WorkManager.getInstance(context)
            .enqueueUniqueWork(NOW_NAME, ExistingWorkPolicy.REPLACE, request)
    }
}
