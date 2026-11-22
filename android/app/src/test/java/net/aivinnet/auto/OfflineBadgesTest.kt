package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OfflineBadgesTest {

    private fun track(hash: String) = TrackInfo(hash, "T$hash", "", emptyList(), 1, "f/$hash", "")

    private fun detail(id: String, vararg hashes: String) = PlaylistDetail(id, "Liste $id", hashes.map(::track))

    @Test
    fun `a copy is complete only when every track of the snapshot is on disk`() {
        val snapshot = detail("7", "a", "b")

        assertTrue(OfflineBrowse.isComplete(snapshot, completed = setOf("a", "b", "x")))
        assertFalse(OfflineBrowse.isComplete(snapshot, completed = setOf("a")))
    }

    @Test
    fun `an empty snapshot, a missing one and an unknown id are not complete`() {
        assertFalse(OfflineBrowse.isComplete(detail("7"), completed = setOf("a")))
        assertFalse(OfflineBrowse.isComplete(null, completed = setOf("a")))
        assertFalse(OfflineBrowse.Badges(emptyMap(), setOf("a")).playlistComplete("nope"))
    }

    @Test
    fun `badges look up the playlist by its id`() {
        val badges = OfflineBrowse.Badges(
            snapshots = mapOf("7" to detail("7", "a"), "8" to detail("8", "a", "b")),
            completed = setOf("a"),
        )

        assertTrue(badges.playlistComplete("7"))
        assertFalse(badges.playlistComplete("8"))
        assertEquals(setOf("a"), badges.completed)
    }
}
