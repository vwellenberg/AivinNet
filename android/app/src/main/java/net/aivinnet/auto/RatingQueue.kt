package net.aivinnet.auto

/**
 * Rating changes waiting for the server, oldest first. A new change for a track replaces the
 * waiting one: the last write per (account, trackhash) wins, so the server never sees a stale
 * value after a newer one. The queue is in memory; [RatingOutbox] writes it to disk.
 */
class RatingQueue(initial: List<QueuedRating> = emptyList(), private val capacity: Int = MAX_ENTRIES) {

    private val entries = ArrayList<QueuedRating>()

    init {
        initial.forEach { record(it) }
    }

    val size: Int get() = entries.size

    fun snapshot(): List<QueuedRating> = entries.toList()

    /** The waiting change for this track, or null when nothing is queued for it. */
    fun pending(owner: String, trackhash: String): QueuedRating? =
        entries.lastOrNull { it.owner == owner && it.trackhash == trackhash }

    /** Replaces the waiting change of the same track (it moves to the end), then drops the oldest over the cap. */
    fun record(change: QueuedRating) {
        entries.removeAll { it.owner == change.owner && it.trackhash == change.trackhash }
        entries.add(change)
        while (entries.size > capacity) entries.removeAt(0)
    }

    /**
     * Sends the changes of [owner], oldest first. Stops at the first [SendOutcome.RETRY] so a change
     * is never overtaken by a newer one. [SendOutcome.REJECTED] changes are dropped without a retry.
     */
    suspend fun drain(owner: String, send: suspend (QueuedRating) -> SendOutcome): DrainResult {
        var sent = 0
        var rejected = 0
        val rejectedTracks = HashSet<String>()
        while (true) {
            val next = entries.firstOrNull { it.owner == owner } ?: break
            when (send(next)) {
                SendOutcome.SENT -> {
                    sent++
                    entries.remove(next)
                }
                SendOutcome.REJECTED -> {
                    rejected++
                    rejectedTracks.add(next.trackhash)
                    entries.remove(next)
                }
                SendOutcome.RETRY -> break
            }
        }
        return DrainResult(
            sent = sent,
            rejected = rejected,
            pending = entries.count { it.owner == owner },
            rejectedTracks = rejectedTracks,
        )
    }

    /** [rejectedTracks]: the tracks whose change the server refused for good, so the button can show the truth. */
    data class DrainResult(
        val sent: Int,
        val rejected: Int,
        val pending: Int,
        val rejectedTracks: Set<String> = emptySet(),
    )

    companion object {
        /** Ratings are tiny; the cap only bounds the file after a very long offline stretch. */
        const val MAX_ENTRIES = 5000
    }
}
