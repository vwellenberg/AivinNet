package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BrowseFreshnessTest {

    private val freshness = BrowseFreshness()

    @Test
    fun `nothing is stale at the start`() {
        assertFalse(freshness.hasStale())
        assertEquals(emptyList<String>(), freshness.takeStale())
    }

    @Test
    fun `an id answered offline is stale until it is taken`() {
        freshness.markOffline("mixes")
        assertTrue(freshness.hasStale())
        assertEquals(listOf("mixes"), freshness.takeStale())
    }

    @Test
    fun `taking the stale ids clears them, so each is returned once`() {
        freshness.markOffline("mixes")
        freshness.markOffline("pl:42")
        assertEquals(listOf("mixes", "pl:42"), freshness.takeStale())
        assertEquals(emptyList<String>(), freshness.takeStale())
        assertFalse(freshness.hasStale())
    }

    @Test
    fun `an answer from the server clears the id`() {
        freshness.markOffline("playlists")
        freshness.markOnline("playlists")
        assertFalse(freshness.hasStale())
        assertEquals(emptyList<String>(), freshness.takeStale())
    }

    @Test
    fun `marking online only clears that id`() {
        freshness.markOffline("mixes")
        freshness.markOffline("playlists")
        freshness.markOnline("mixes")
        assertEquals(listOf("playlists"), freshness.takeStale())
    }

    @Test
    fun `marking an id offline twice keeps it once`() {
        freshness.markOffline("pl:7")
        freshness.markOffline("pl:7")
        assertEquals(listOf("pl:7"), freshness.takeStale())
    }

    @Test
    fun `an id can go stale again after it was taken`() {
        freshness.markOffline("mixes")
        freshness.takeStale()
        freshness.markOffline("mixes")
        assertTrue(freshness.hasStale())
        assertEquals(listOf("mixes"), freshness.takeStale())
    }
}
