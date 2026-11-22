package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SearchRulesTest {

    private fun track(hash: String, title: String, artist: String = "Anna", album: String = "Album") = TrackInfo(
        trackhash = hash,
        title = title,
        album = album,
        artists = listOf(artist),
        duration = 200,
        filepath = "music/$hash.flac",
        image = "",
    )

    @Test
    fun `normalize trims and collapses whitespace, and blank is empty`() {
        assertEquals("Nightcall Kavinsky", SearchRules.normalize("  Nightcall   Kavinsky "))
        assertEquals("", SearchRules.normalize("   "))
        assertEquals("", SearchRules.normalize(null))
    }

    @Test
    fun `fold drops accents and case`() {
        assertEquals("beyonce", SearchRules.fold("Beyoncé"))
        assertEquals("aou", SearchRules.fold("ÄÖÜ"))
    }

    @Test
    fun `the title match outranks a prefix, a word in the title, and an artist`() {
        val candidates = listOf(
            track("a", "Lost in Nightcall Land"),
            track("b", "Nightcall Club", artist = "Other"),
            track("c", "Nightcall"),
            track("d", "Nightcalls", artist = "Other"),
            track("e", "Sunday", artist = "Nightcall Crew"),
        )

        val found = SearchRules.offlineMatches("nightcall", candidates)

        assertEquals(listOf("c", "b", "d", "a", "e"), found.map { it.trackhash })
    }

    @Test
    fun `ties keep the order of the candidates`() {
        val candidates = listOf(track("x", "Blue Song"), track("y", "Blue Moon"))

        assertEquals(listOf("x", "y"), SearchRules.offlineMatches("blue", candidates).map { it.trackhash })
    }

    @Test
    fun `matching ignores case and accents`() {
        val candidates = listOf(track("h", "Halo", artist = "Beyoncé"))

        assertEquals(listOf("h"), SearchRules.offlineMatches("BEYONCE", candidates).map { it.trackhash })
    }

    @Test
    fun `a match on the album counts`() {
        val candidates = listOf(track("m", "Track 1", album = "Discovery"))

        assertEquals(listOf("m"), SearchRules.offlineMatches("discov", candidates).map { it.trackhash })
    }

    @Test
    fun `a track listed twice is found once and the limit is kept`() {
        val candidates = listOf(
            track("1", "Song A"),
            track("1", "Song A"),
            track("2", "Song B"),
            track("3", "Song C"),
        )

        val found = SearchRules.offlineMatches("song", candidates, limit = 2)

        assertEquals(listOf("1", "2"), found.map { it.trackhash })
    }

    @Test
    fun `no match and a blank query find nothing`() {
        val candidates = listOf(track("1", "Song A"))

        assertTrue(SearchRules.offlineMatches("zebra", candidates).isEmpty())
        assertTrue(SearchRules.offlineMatches("   ", candidates).isEmpty())
    }
}
