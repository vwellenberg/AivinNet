package net.aivinnet.auto

import java.io.File
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class ScrobbleQueueTest {

    @get:Rule
    val folder = TemporaryFolder()

    private fun play(hash: String, timestamp: Long) = ScrobblePlay(hash, timestamp, 30, "pl:7")

    @Test
    fun `plays are sent oldest first and the sent ones leave the queue`() = runBlocking {
        val queue = ScrobbleQueue(
            listOf(QueuedPlay("alice", play("a", 1)), QueuedPlay("alice", play("b", 2))),
        )
        val sent = mutableListOf<String>()

        val result = queue.drain("alice") { sent += it.trackhash; SendOutcome.SENT }

        assertEquals(listOf("a", "b"), sent)
        assertEquals(ScrobbleQueue.DrainResult(sent = 2, rejected = 0, pending = 0), result)
        assertEquals(0, queue.size)
    }

    @Test
    fun `a retry stops the drain, so a newer play never overtakes an older one`() = runBlocking {
        val queue = ScrobbleQueue(
            listOf(QueuedPlay("alice", play("a", 1)), QueuedPlay("alice", play("b", 2))),
        )
        val tried = mutableListOf<String>()

        val result = queue.drain("alice") { tried += it.trackhash; SendOutcome.RETRY }

        assertEquals(listOf("a"), tried)
        assertEquals(2, queue.size)
        assertEquals(ScrobbleQueue.DrainResult(sent = 0, rejected = 0, pending = 2), result)
    }

    @Test
    fun `a rejected play is dropped without a retry and the next one still goes`() = runBlocking {
        val queue = ScrobbleQueue(
            listOf(QueuedPlay("alice", play("gone", 1)), QueuedPlay("alice", play("b", 2))),
        )

        val result = queue.drain("alice") {
            if (it.trackhash == "gone") SendOutcome.REJECTED else SendOutcome.SENT
        }

        assertEquals(ScrobbleQueue.DrainResult(sent = 1, rejected = 1, pending = 0), result)
        assertEquals(0, queue.size)
    }

    @Test
    fun `plays of another account are left alone`() = runBlocking {
        val queue = ScrobbleQueue(
            listOf(QueuedPlay("bob", play("b", 1)), QueuedPlay("alice", play("a", 2))),
        )
        val sent = mutableListOf<String>()

        queue.drain("alice") { sent += it.trackhash; SendOutcome.SENT }

        assertEquals(listOf("a"), sent)
        assertEquals(listOf(QueuedPlay("bob", play("b", 1))), queue.snapshot())
    }

    @Test
    fun `over the cap the oldest play goes and the timestamps stay the originals`() {
        val queue = ScrobbleQueue(capacity = 3)

        for (i in 1..5) queue.add(QueuedPlay("alice", play("t$i", timestamp = 1_000L + i)))

        assertEquals(
            listOf("t3", "t4", "t5"),
            queue.snapshot().map { it.play.trackhash },
        )
        assertEquals(1_003L, queue.snapshot().first().play.timestamp)
    }

    @Test
    fun `the default cap is 5000`() {
        assertEquals(5000, ScrobbleQueue.MAX_ENTRIES)
    }

    @Test
    fun `accepted answers are sent, the server's final refusals are rejected`() {
        assertEquals(SendOutcome.SENT, ScrobbleResponses.outcome(200))
        assertEquals(SendOutcome.REJECTED, ScrobbleResponses.outcome(400))
        assertEquals(SendOutcome.REJECTED, ScrobbleResponses.outcome(404))
        assertEquals(SendOutcome.REJECTED, ScrobbleResponses.outcome(422))
    }

    @Test
    fun `auth failures, timeouts, rate limits and server faults are kept`() {
        assertEquals(SendOutcome.RETRY, ScrobbleResponses.outcome(401))
        assertEquals(SendOutcome.RETRY, ScrobbleResponses.outcome(408))
        assertEquals(SendOutcome.RETRY, ScrobbleResponses.outcome(429))
        assertEquals(SendOutcome.RETRY, ScrobbleResponses.outcome(500))
        assertEquals(SendOutcome.RETRY, ScrobbleResponses.outcome(502))
    }

    @Test
    fun `an outbox writes its queue, a new outbox reads it back in order`() = runBlocking {
        val file = File(folder.root, "scrobble-queue.json")
        val log = { _: String, _: Throwable? -> }
        val first = ScrobbleOutbox(JsonFile(file, emptyList(), OfflineJson::decodeQueue, OfflineJson::encodeQueue, log), log)

        // Offline: the send fails, so both plays wait on disk.
        first.record("alice", play("a", 1)) { SendOutcome.RETRY }
        first.record("alice", play("b", 2)) { SendOutcome.RETRY }

        val second = ScrobbleOutbox(JsonFile(file, emptyList(), OfflineJson::decodeQueue, OfflineJson::encodeQueue, log), log)
        val sent = mutableListOf<String>()
        val result = second.flush("alice") { sent += it.trackhash; SendOutcome.SENT }

        assertEquals(listOf("a", "b"), sent)
        assertEquals(2, result.sent)
    }

    @Test
    fun `a play sent while online is not kept on disk afterwards`() = runBlocking {
        val file = File(folder.root, "scrobble-queue.json")
        val log = { _: String, _: Throwable? -> }
        val outbox = ScrobbleOutbox(JsonFile(file, emptyList(), OfflineJson::decodeQueue, OfflineJson::encodeQueue, log), log)

        outbox.record("alice", play("a", 1)) { SendOutcome.SENT }

        assertEquals(emptyList<QueuedPlay>(), OfflineJson.decodeQueue(file.readText()))
    }
}
