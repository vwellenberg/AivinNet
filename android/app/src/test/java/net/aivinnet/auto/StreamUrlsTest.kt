package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class StreamUrlsTest {

    private val hash = "9f8e7d6c5b4a3210"

    @Test
    fun `builds a plain stream url`() {
        assertEquals(
            "http://192.168.1.10:1970/file/$hash/legacy?filepath=%2Fmusic%2Fa.mp3",
            StreamUrls.build("http://192.168.1.10:1970", hash, "/music/a.mp3"),
        )
    }

    @Test
    fun `encodes spaces as percent-20 and umlauts as utf-8, never plus`() {
        val url = StreamUrls.build("http://srv:1970", hash, "/musik/Ärzte & Söhne/Lied 1.flac")

        assertEquals(
            "http://srv:1970/file/$hash/legacy?filepath=" +
                "%2Fmusik%2F%C3%84rzte%20%26%20S%C3%B6hne%2FLied%201.flac",
            url,
        )
        assertEquals(false, url.contains('+'))
    }

    @Test
    fun `base url with a trailing slash does not double it`() {
        assertEquals(
            "http://srv:1970/file/$hash/legacy?filepath=%2Fa.mp3",
            StreamUrls.build("http://srv:1970/", hash, "/a.mp3"),
        )
    }

    @Test
    fun `server url gets http when the scheme is missing`() {
        assertEquals("http://192.168.1.10:1970", ServerUrl.normalize(" 192.168.1.10:1970/ "))
        assertEquals("https://music.example.net", ServerUrl.normalize("https://music.example.net/"))
        assertEquals("", ServerUrl.normalize("   "))
    }
}
