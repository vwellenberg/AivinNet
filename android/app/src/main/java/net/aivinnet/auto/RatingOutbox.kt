package net.aivinnet.auto

import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * The persisted [RatingQueue] of the process. Serialises every change and every send, so the
 * playback service and the sync worker cannot send the same change twice.
 *
 * As with the scrobble outbox, a change is written to disk before its request goes out, so a
 * process killed mid-request sends it again on the next flush.
 */
class RatingOutbox(
    private val file: JsonFile<List<QueuedRating>>,
    private val log: ErrorLog,
) {
    private val mutex = Mutex()
    private val queue = RatingQueue(file.load())

    /** Stores the change, then sends the waiting changes of [owner], oldest first. */
    suspend fun record(
        owner: String,
        trackhash: String,
        rating: Int?,
        send: suspend (QueuedRating) -> SendOutcome,
    ): RatingQueue.DrainResult = mutex.withLock {
        queue.record(QueuedRating(owner, trackhash, rating))
        persist()
        drainAndPersist(owner, send)
    }

    /** Sends whatever is waiting for [owner]. */
    suspend fun flush(
        owner: String,
        send: suspend (QueuedRating) -> SendOutcome,
    ): RatingQueue.DrainResult = mutex.withLock { drainAndPersist(owner, send) }

    /** The change still waiting for this track, if any: it is the truth until the server has it. */
    suspend fun pending(owner: String, trackhash: String): QueuedRating? =
        mutex.withLock { queue.pending(owner, trackhash) }

    private suspend fun drainAndPersist(
        owner: String,
        send: suspend (QueuedRating) -> SendOutcome,
    ): RatingQueue.DrainResult = queue.drain(owner, send).also { persist() }

    private fun persist() {
        try {
            file.save(queue.snapshot())
        } catch (e: IOException) {
            log("Rating queue could not be saved", e)
        }
    }
}

/** Sends one rating change. Errors become answers, never crashes: the callers run in background scopes. */
suspend fun sendRating(change: QueuedRating, api: AivinApi, log: ErrorLog): SendOutcome = try {
    val rating = change.rating
    if (rating == null) api.clearRating(change.trackhash) else api.setRating(change.trackhash, rating)
    SendOutcome.SENT
} catch (e: ServerException) {
    // The answer rules of scrobbles apply: 404 (unknown track) and other 4xx are final, 401/408/429/5xx wait.
    ScrobbleResponses.outcome(e.code)
} catch (e: CancellationException) {
    throw e
} catch (e: Exception) {
    log("Rating kept for a later try", e)
    SendOutcome.RETRY
}
