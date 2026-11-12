package net.aivinnet.auto

import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RatingQueueTest {

    @Test
    fun `last write per track wins`() {
        val queue = RatingQueue()

        queue.record(QueuedRating("alice", "a", 5))
        queue.record(QueuedRating("alice", "a", null))

        assertEquals(listOf(QueuedRating("alice", "a", null)), queue.snapshot())
        assertEquals(QueuedRating("alice", "a", null), queue.pending("alice", "a"))
    }

    @Test
    fun `a newer change for one track leaves other tracks alone`() {
        val queue = RatingQueue()

        queue.record(QueuedRating("alice", "a", 5))
        queue.record(QueuedRating("alice", "b", 2))
        queue.record(QueuedRating("alice", "a", 1))

        assertEquals(
            listOf(QueuedRating("alice", "b", 2), QueuedRating("alice", "a", 1)),
            queue.snapshot(),
        )
    }

    @Test
    fun `accounts are merged separately`() {
        val queue = RatingQueue()

        queue.record(QueuedRating("alice", "a", 5))
        queue.record(QueuedRating("bob", "a", 2))

        assertEquals(5, queue.pending("alice", "a")?.rating)
        assertEquals(2, queue.pending("bob", "a")?.rating)
        assertNull(queue.pending("carol", "a"))
    }

    @Test
    fun `drain sends the changes of one owner oldest first`() = runBlocking {
        val queue = RatingQueue(
            listOf(
                QueuedRating("alice", "a", 5),
                QueuedRating("bob", "x", 4),
                QueuedRating("alice", "b", null),
            ),
        )
        val sent = mutableListOf<String>()

        val result = queue.drain("alice") { sent += it.trackhash; SendOutcome.SENT }

        assertEquals(listOf("a", "b"), sent)
        assertEquals(RatingQueue.DrainResult(sent = 2, rejected = 0, pending = 0), result)
        assertEquals(listOf(QueuedRating("bob", "x", 4)), queue.snapshot())
    }

    @Test
    fun `a retry stops the drain so later changes are not overtaken`() = runBlocking {
        val queue = RatingQueue(listOf(QueuedRating("alice", "a", 5), QueuedRating("alice", "b", 3)))
        val sent = mutableListOf<String>()

        val result = queue.drain("alice") { sent += it.trackhash; SendOutcome.RETRY }

        assertEquals(listOf("a"), sent)
        assertEquals(RatingQueue.DrainResult(sent = 0, rejected = 0, pending = 2), result)
        assertEquals(2, queue.size)
    }

    @Test
    fun `a rejected change is dropped without a retry`() = runBlocking {
        val queue = RatingQueue(listOf(QueuedRating("alice", "a", 5), QueuedRating("alice", "b", 3)))

        val result = queue.drain("alice") {
            if (it.trackhash == "a") SendOutcome.REJECTED else SendOutcome.SENT
        }

        assertEquals(RatingQueue.DrainResult(sent = 1, rejected = 1, pending = 0), result)
        assertEquals(0, queue.size)
    }

    @Test
    fun `the cap drops the oldest change`() {
        val queue = RatingQueue(capacity = 2)

        queue.record(QueuedRating("alice", "a", 5))
        queue.record(QueuedRating("alice", "b", 5))
        queue.record(QueuedRating("alice", "c", 5))

        assertEquals(listOf("b", "c"), queue.snapshot().map { it.trackhash })
    }

    @Test
    fun `the queue file round-trips a clear as null`() {
        val entries = listOf(QueuedRating("alice", "a", 5), QueuedRating("alice", "b", null))

        val decoded = OfflineJson.decodeRatings(OfflineJson.encodeRatings(entries))

        assertEquals(entries, decoded)
    }
}
