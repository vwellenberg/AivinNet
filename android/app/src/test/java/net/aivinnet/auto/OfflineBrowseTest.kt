package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class OfflineBrowseTest {

    private fun track(hash: String) = TrackInfo(hash, "T$hash", "", emptyList(), 1, "f/$hash", "")

    private fun detail(id: String, name: String, vararg hashes: String) =
        PlaylistDetail(id, name, hashes.map(::track))

    @Test
    fun `only completely downloaded tracks are listed, in the playlist's order`() {
        val snapshot = detail("7", "Liste", "c", "a", "b")

        val playable = OfflineBrowse.playable(snapshot, completed = setOf("a", "c"))

        assertEquals(listOf("c", "a"), playable.tracks.map { it.trackhash })
    }

    @Test
    fun `a playlist without any downloaded track is not offered`() {
        val listed = OfflineBrowse.listed(
            snapshots = mapOf("7" to detail("7", "Leer", "a")),
            completed = emptySet(),
            include = { true },
        )

        assertEquals(emptyList<PlaylistDetail>(), listed)
    }

    @Test
    fun `an unsynced entry is not offered`() {
        val listed = OfflineBrowse.listed(
            snapshots = mapOf("7" to null),
            completed = setOf("a"),
            include = { true },
        )

        assertEquals(emptyList<PlaylistDetail>(), listed)
    }

    @Test
    fun `mixes and playlists are split by the include predicate and sorted by name`() {
        val snapshots = mapOf(
            "7" to detail("7", "zebra", "a"),
            "1" to detail("1", "Alpha", "a"),
            "mix1" to detail("mix1", "Mix 1", "a"),
        )
        val completed = setOf("a")

        val mixes = OfflineBrowse.listed(snapshots, completed) { it.startsWith("mix") }
        val playlists = OfflineBrowse.listed(snapshots, completed) { !it.startsWith("mix") }

        assertEquals(listOf("Mix 1"), mixes.map { it.name })
        assertEquals(listOf("Alpha", "zebra"), playlists.map { it.name })
    }
}
