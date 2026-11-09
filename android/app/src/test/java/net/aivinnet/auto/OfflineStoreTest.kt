package net.aivinnet.auto

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class OfflineStoreTest {

    @get:Rule
    val folder = TemporaryFolder()

    private val logged = mutableListOf<String>()
    private fun log(message: String, cause: Throwable?) {
        logged += message
    }

    private fun track(hash: String) = TrackInfo(
        trackhash = hash,
        title = "Titel \"$hash\" ✓",
        album = "Album",
        artists = listOf("Eins", "Zwei"),
        duration = 201,
        filepath = "music/Ordner mit Leerzeichen/$hash.flac",
        image = "$hash.webp?pathhash=x",
    )

    @Test
    fun `state survives a round trip through the file`() {
        val file = File(folder.root, "offline.json")
        val store = OfflineStore(file, ::log)
        val detail = PlaylistDetail("7", "Roadtrip", listOf(track("a"), track("b")))

        store.update {
            it.copy(allowMobile = true)
                .withOffline("alice|https://x", "7")
                .withSnapshot("alice|https://x", "7", detail)
                .withOffline("alice|https://x", "mix1")
        }

        val loaded = OfflineStore(file, ::log).load()
        assertTrue(loaded.allowMobile)
        assertEquals(detail, loaded.snapshots("alice|https://x")["7"])
        assertNull(loaded.snapshots("alice|https://x")["mix1"])
        assertTrue(logged.isEmpty())
    }

    @Test
    fun `a missing file reads as empty without a log line`() {
        val state = OfflineStore(File(folder.root, "nope.json"), ::log).load()

        assertEquals(OfflineState(), state)
        assertTrue(logged.isEmpty())
    }

    @Test
    fun `a broken file starts empty and is logged, it does not crash`() {
        val file = File(folder.root, "offline.json")
        file.writeText("{\"accounts\": {\"alice\": {\"7\": ")

        val state = OfflineStore(file, ::log).load()

        assertEquals(OfflineState(), state)
        assertEquals(1, logged.size)
    }

    @Test
    fun `the next write replaces a broken file and leaves no temp file behind`() {
        val file = File(folder.root, "offline.json")
        file.writeText("not json at all")
        val store = OfflineStore(file, ::log)

        store.update { it.withOffline("alice", "mix2") }

        assertEquals(setOf("mix2"), store.load().offlineIds("alice"))
        assertFalse(File(folder.root, "offline.json.tmp").exists())
    }

    @Test
    fun `a sync that finishes after an unmark does not add the playlist back`() {
        val state = OfflineState()
            .withOffline("alice", "7")
            .withoutOffline("alice", "7")
            .withSnapshot("alice", "7", PlaylistDetail("7", "Liste", emptyList()))

        assertEquals(emptySet<String>(), state.offlineIds("alice"))
    }

    @Test
    fun `unmarking the last playlist of an account drops the account`() {
        val state = OfflineState().withOffline("alice", "7").withoutOffline("alice", "7")

        assertEquals(emptyMap<String, Map<String, PlaylistDetail?>>(), state.accounts)
    }

    @Test
    fun `allSnapshots covers every account and skips unsynced entries`() {
        val a = PlaylistDetail("1", "A", listOf(track("a")))
        val b = PlaylistDetail("2", "B", listOf(track("b")))
        val state = OfflineState(
            accounts = mapOf(
                "alice" to mapOf("1" to a, "mix1" to null),
                "bob" to mapOf("2" to b),
            ),
        )

        assertEquals(listOf(a, b), state.allSnapshots().sortedBy { it.id })
    }
}
