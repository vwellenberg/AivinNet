package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class OfflinePlanTest {

    private fun track(hash: String) = TrackInfo(
        trackhash = hash,
        title = "Titel $hash",
        album = "Album",
        artists = listOf("Artist"),
        duration = 200,
        filepath = "music/$hash.mp3",
        image = "",
    )

    private fun playlist(id: String, vararg hashes: String) =
        PlaylistDetail(id, "Liste $id", hashes.map(::track))

    @Test
    fun `every track of an offline playlist is downloaded once`() {
        val diff = OfflinePlan.diff(listOf(playlist("7", "a", "b")), downloaded = emptySet())

        assertEquals(setOf("a", "b"), diff.toDownload)
        assertEquals(emptySet<String>(), diff.toRemove)
    }

    @Test
    fun `a track already downloaded is not downloaded again`() {
        val diff = OfflinePlan.diff(listOf(playlist("7", "a", "b")), downloaded = setOf("a"))

        assertEquals(setOf("b"), diff.toDownload)
        assertEquals(emptySet<String>(), diff.toRemove)
    }

    @Test
    fun `a track shared by two offline playlists is one download`() {
        val diff = OfflinePlan.diff(
            listOf(playlist("7", "a", "shared"), playlist("mix1", "shared", "c")),
            downloaded = emptySet(),
        )

        assertEquals(setOf("a", "shared", "c"), diff.toDownload)
    }

    @Test
    fun `unmarking one of two playlists keeps the track the other still lists`() {
        // Only "mix1" is offline now; "shared" is still in it, "a" was only in the removed playlist.
        val diff = OfflinePlan.diff(
            listOf(playlist("mix1", "shared")),
            downloaded = setOf("a", "shared"),
        )

        assertEquals(setOf("a"), diff.toRemove)
        assertEquals(emptySet<String>(), diff.toDownload)
    }

    @Test
    fun `an empty mix references nothing, so everything downloaded for it goes`() {
        val diff = OfflinePlan.diff(listOf(playlist("mix2")), downloaded = setOf("a", "b"))

        assertEquals(setOf("a", "b"), diff.toRemove)
        assertEquals(emptySet<String>(), diff.toDownload)
    }

    @Test
    fun `with no offline playlist at all, every download is removed`() {
        val diff = OfflinePlan.diff(emptyList(), downloaded = setOf("a"))

        assertEquals(setOf("a"), diff.toRemove)
    }

    @Test
    fun `a track listed by another account's offline playlist is kept`() {
        // The snapshots of all accounts are passed in: the removal must not look at one account only.
        val otherAccount = playlist("mix1", "a")
        val diff = OfflinePlan.diff(listOf(otherAccount), downloaded = setOf("a"))

        assertEquals(emptySet<String>(), diff.toRemove)
    }

    @Test
    fun `a failed download is requeued because it is not in the downloaded set`() {
        // The caller leaves FAILED downloads out of [downloaded], so the next sync re-adds them.
        val diff = OfflinePlan.diff(listOf(playlist("7", "a")), downloaded = emptySet())

        assertEquals(setOf("a"), diff.toDownload)
    }

    @Test
    fun `a failed download of a wanted track is queued again`() {
        val diff = OfflinePlan.diff(listOf(playlist("7", "a")), downloaded = emptySet(), failed = setOf("a"))

        assertEquals(setOf("a"), diff.toDownload)
        assertEquals(emptySet<String>(), diff.toRemove)
    }

    @Test
    fun `a failed download nobody wants any more is removed, partial bytes and all`() {
        val diff = OfflinePlan.diff(emptyList(), downloaded = emptySet(), failed = setOf("a"))

        assertEquals(setOf("a"), diff.toRemove)
    }
}
