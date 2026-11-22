package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test

class SearchCacheTest {

    private fun track(hash: String) = TrackInfo(
        trackhash = hash,
        title = "Title $hash",
        album = "",
        artists = emptyList(),
        duration = 100,
        filepath = "music/$hash.mp3",
        image = "",
    )

    private fun search(query: String, vararg hashes: String) =
        SearchResults(query, hashes.map(::track), albums = emptyList())

    @Test
    fun `a tapped track queues the search it was shown in, from that track on`() {
        val cache = SearchCache()
        cache.put(search("nightcall", "a", "b", "c"))

        val queue = cache.queueOf("b")

        assertEquals(listOf("a", "b", "c"), queue?.tracks?.map { it.trackhash })
        assertEquals(1, queue?.index)
    }

    @Test
    fun `a track in two kept searches queues the newer one`() {
        val cache = SearchCache()
        cache.put(search("first", "a", "b"))
        cache.put(search("second", "b", "a"))

        val queue = cache.queueOf("a")

        assertEquals(listOf("b", "a"), queue?.tracks?.map { it.trackhash })
        assertEquals(1, queue?.index)
    }

    @Test
    fun `only the last three searches are kept`() {
        val cache = SearchCache()
        cache.put(search("one", "x"))
        cache.put(search("two", "y"))
        cache.put(search("three", "z"))
        cache.put(search("four", "w"))

        assertNull(cache.get("one"))
        assertNull(cache.queueOf("x"))
        assertEquals("w", cache.queueOf("w")?.tracks?.single()?.trackhash)
    }

    @Test
    fun `searching the same query again replaces it and makes it the newest`() {
        val cache = SearchCache()
        cache.put(search("same", "x"))
        cache.put(search("other", "y"))
        cache.put(search("same", "z"))
        cache.put(search("third", "w"))

        // "same" was searched again, so it is the newest of the three and nothing was pushed out yet.
        assertEquals("z", cache.get("same")?.tracks?.single()?.trackhash)
        assertNull(cache.queueOf("x"))
    }

    @Test
    fun `the query key is normalised`() {
        val cache = SearchCache()
        val results = search("a  b", "x")
        cache.put(results)

        assertSame(results, cache.get("  a b "))
    }
}
