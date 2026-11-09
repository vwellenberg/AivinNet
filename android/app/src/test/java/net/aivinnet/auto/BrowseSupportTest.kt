package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PlaylistCacheTest {

    private var clock = 0L
    private val cache = PlaylistCache(ttlMs = 1_000, now = { clock })
    private val mix = PlaylistDetail("mix1", "Mix 1", emptyList())

    @Test
    fun `a tap within the ttl gets the list the car showed`() {
        cache.put("mix1", mix)
        clock = 999
        assertEquals(mix, cache.get("mix1")?.detail)
    }

    @Test
    fun `an old entry is dropped`() {
        cache.put("mix1", mix)
        clock = 1_001
        assertNull(cache.get("mix1"))
    }

    @Test
    fun `a cached 404 is a hit with no detail, not a miss`() {
        cache.put("mix4", null)
        val hit = cache.get("mix4")
        assertTrue(hit != null)
        assertNull(hit?.detail)
    }
}

class PagingTest {

    private val items = (0 until 10).toList()

    @Test
    fun `legacy browsers asking for everything get everything`() {
        assertEquals(items, Paging.slice(items, 0, Int.MAX_VALUE))
        assertEquals(items, Paging.slice(items, 0, 0))
    }

    @Test
    fun `pages do not repeat`() {
        assertEquals(listOf(0, 1, 2, 3), Paging.slice(items, 0, 4))
        assertEquals(listOf(4, 5, 6, 7), Paging.slice(items, 1, 4))
        assertEquals(listOf(8, 9), Paging.slice(items, 2, 4))
        assertEquals(emptyList<Int>(), Paging.slice(items, 3, 4))
    }

    @Test
    fun `huge playlists are capped for one binder answer`() {
        val big = (0 until 5_000).toList()
        assertEquals(Paging.MAX_BROWSE_ITEMS, Paging.slice(big, 0, Int.MAX_VALUE).size)
    }

    @Test
    fun `a page index times a huge page size does not overflow`() {
        assertEquals(emptyList<Int>(), Paging.slice(items, 2, Int.MAX_VALUE))
    }
}

class TransportTest {

    @Test
    fun `plain http over the internet is flagged`() {
        assertTrue(Transport.isUnencryptedRemote("http://music.example.org:1970"))
        assertTrue(Transport.isUnencryptedRemote("http://203.0.113.7:1970"))
    }

    @Test
    fun `https, lan and vpn addresses are fine`() {
        assertFalse(Transport.isUnencryptedRemote("https://music.example.org"))
        assertFalse(Transport.isUnencryptedRemote("http://192.168.1.10:1970"))
        assertFalse(Transport.isUnencryptedRemote("http://10.0.0.5:1970"))
        assertFalse(Transport.isUnencryptedRemote("http://172.20.1.1:1970"))
        assertFalse(Transport.isUnencryptedRemote("http://100.101.102.103:1970"))
        assertFalse(Transport.isUnencryptedRemote("http://nas.local:1970"))
        assertFalse(Transport.isUnencryptedRemote("http://localhost:1970"))
    }

    @Test
    fun `addresses that only look private are not`() {
        assertTrue(Transport.isUnencryptedRemote("http://172.32.0.1:1970"))
        assertTrue(Transport.isUnencryptedRemote("http://192.168.example.org:1970"))
    }
}

class AivinJsonErrorTest {

    @Test(expected = AivinException::class)
    fun `an html page instead of json is an AivinException, not a crash`() {
        AivinJson.parseLogin("<html><body>Captive portal</body></html>")
    }

    @Test(expected = AivinException::class)
    fun `a playlist answer that is not json is an AivinException`() {
        AivinJson.parsePlaylistDetail("7", "Bad Gateway")
    }
}
