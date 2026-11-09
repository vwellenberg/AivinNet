package net.aivinnet.auto

import java.io.IOException
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/** A play that the server has not confirmed yet, with the account it was made under. */
data class QueuedPlay(val owner: String, val play: ScrobblePlay)

/** What became of one play when it was sent. */
enum class SendOutcome {
    /** The server stored it. */
    SENT,

    /** The server refused this play for good. Retrying would only refuse it again. */
    REJECTED,

    /** Nothing was decided: no network, a server fault, or a rate limit. Keep it and try later. */
    RETRY,
}

/** Maps the HTTP answer of `POST /logger/track/log` to what to do with the play. */
object ScrobbleResponses {

    /**
     * 400 (invalid entry, under 5 s) and 404 (track unknown) are the server's final word, so those
     * plays are dropped. 401 means the session failed and 408/429 are timeouts or rate limits, so
     * those stay queued. Other 4xx answers (422 from request validation) are final too.
     */
    fun outcome(code: Int): SendOutcome = when (code) {
        in 200..299 -> SendOutcome.SENT
        401, 408, 429 -> SendOutcome.RETRY
        in 400..499 -> SendOutcome.REJECTED
        else -> SendOutcome.RETRY
    }
}

/**
 * Plays waiting for the server, oldest first. The queue itself is in memory; [ScrobbleOutbox]
 * writes it to disk and serialises the callers.
 */
class ScrobbleQueue(initial: List<QueuedPlay> = emptyList(), private val capacity: Int = MAX_ENTRIES) {

    private val entries = ArrayDeque<QueuedPlay>()

    init {
        initial.forEach { add(it) }
    }

    val size: Int get() = entries.size

    fun snapshot(): List<QueuedPlay> = entries.toList()

    /**
     * Appends [entry]. Over the cap the *oldest* play goes: a backlog of days should not block the
     * newest plays, and the oldest are the least likely to still matter. Each play keeps the
     * timestamp it was made with, so the server stores the real listening time.
     */
    fun add(entry: QueuedPlay) {
        entries.addLast(entry)
        while (entries.size > capacity) entries.removeFirst()
    }

    /**
     * Sends the plays of [owner] oldest first. Stops at the first [SendOutcome.RETRY], so a play
     * is never overtaken by a newer one. [SendOutcome.REJECTED] plays are removed without a retry.
     * Plays of other accounts are left alone.
     */
    suspend fun drain(owner: String, send: suspend (ScrobblePlay) -> SendOutcome): DrainResult {
        var sent = 0
        var rejected = 0
        while (true) {
            val next = entries.firstOrNull { it.owner == owner } ?: break
            when (send(next.play)) {
                SendOutcome.SENT -> {
                    sent++
                    entries.remove(next)
                }
                SendOutcome.REJECTED -> {
                    rejected++
                    entries.remove(next)
                }
                SendOutcome.RETRY -> break
            }
        }
        return DrainResult(sent = sent, rejected = rejected, pending = entries.count { it.owner == owner })
    }

    data class DrainResult(val sent: Int, val rejected: Int, val pending: Int)

    companion object {
        /** About a year of normal listening. Bounds the file and the time to send a backlog. */
        const val MAX_ENTRIES = 5000
    }
}

/**
 * The one scrobble queue of the process, persisted in [file]. Serialises every change, so the
 * playback service and the sync worker cannot send the same play twice from two copies.
 *
 * Delivery is at least once: a play is written to disk before its request goes out, so a process
 * killed mid-request sends it again on the next flush instead of losing it.
 */
class ScrobbleOutbox(
    private val file: JsonFile<List<QueuedPlay>>,
    private val log: ErrorLog,
) {
    private val mutex = Mutex()
    private val queue = ScrobbleQueue(file.load())

    /** Queues [play] behind everything waiting and sends the plays of [owner], oldest first. */
    suspend fun record(
        owner: String,
        play: ScrobblePlay,
        send: suspend (ScrobblePlay) -> SendOutcome,
    ): ScrobbleQueue.DrainResult = mutex.withLock {
        queue.add(QueuedPlay(owner, play))
        persist()
        drainAndPersist(owner, send)
    }

    /** Sends whatever is waiting for [owner], without a new play. */
    suspend fun flush(
        owner: String,
        send: suspend (ScrobblePlay) -> SendOutcome,
    ): ScrobbleQueue.DrainResult = mutex.withLock { drainAndPersist(owner, send) }

    private suspend fun drainAndPersist(
        owner: String,
        send: suspend (ScrobblePlay) -> SendOutcome,
    ): ScrobbleQueue.DrainResult = queue.drain(owner, send).also { persist() }

    private fun persist() {
        try {
            file.save(queue.snapshot())
        } catch (e: IOException) {
            // The plays stay in memory and the next save tries again; a full disk must not stop playback.
            log("Scrobble queue could not be saved", e)
        }
    }
}

/** Sending one play. A thrown error is a retry, never a crash: the callers run in background scopes. */
suspend fun sendScrobble(
    play: ScrobblePlay,
    logPlay: suspend (ScrobblePlay) -> Unit,
    log: ErrorLog,
): SendOutcome = try {
    logPlay(play)
    SendOutcome.SENT
} catch (e: ServerException) {
    ScrobbleResponses.outcome(e.code)
} catch (e: kotlinx.coroutines.CancellationException) {
    // Cooperative cancellation (a replaced or stopped worker) must reach the caller, not count as a retry.
    throw e
} catch (e: Exception) {
    log("Scrobble kept for a later try", e)
    SendOutcome.RETRY
}
