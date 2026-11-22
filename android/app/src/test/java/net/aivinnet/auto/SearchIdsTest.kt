package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SearchIdsTest {

    @Test
    fun `formats and parses a search track`() {
        val id = MediaIds.searchTrack("9f8e7d6c5b4a3210")

        assertEquals("st:9f8e7d6c5b4a3210", id)
        assertEquals(MediaRef.SearchTrack("9f8e7d6c5b4a3210"), MediaIds.parse(id))
    }

    @Test
    fun `formats and parses an album and a track of it`() {
        assertEquals("al:b2c3d4e5", MediaIds.album("b2c3d4e5"))
        assertEquals(MediaRef.Album("b2c3d4e5"), MediaIds.parse("al:b2c3d4e5"))

        val id = MediaIds.albumTrack("b2c3d4e5", "9f8e7d6c")
        assertEquals("at:b2c3d4e5:9f8e7d6c", id)
        assertEquals(MediaRef.AlbumTrack("b2c3d4e5", "9f8e7d6c"), MediaIds.parse(id))
    }

    @Test
    fun `malformed search and album ids are unknown`() {
        assertEquals(MediaRef.Unknown, MediaIds.parse("st:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("st:a:b"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("al:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("al:a:b"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("at:album:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("at::track"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("at:a:b:c"))
    }

    @Test
    fun `the playlist track ids are unchanged`() {
        assertEquals(MediaRef.Track("7", "abc"), MediaIds.parse("tr:7:abc"))
    }

    @Test
    fun `every track kind yields its trackhash and the server's scrobble source`() {
        assertEquals("abc", MediaIds.trackhashOf(MediaRef.Track("7", "abc")))
        assertEquals("pl:7", MediaIds.scrobbleSource(MediaRef.Track("7", "abc")))

        assertEquals("abc", MediaIds.trackhashOf(MediaRef.SearchTrack("abc")))
        assertEquals("q:", MediaIds.scrobbleSource(MediaRef.SearchTrack("abc")))

        assertEquals("abc", MediaIds.trackhashOf(MediaRef.AlbumTrack("al9", "abc")))
        assertEquals("al:al9", MediaIds.scrobbleSource(MediaRef.AlbumTrack("al9", "abc")))
    }

    @Test
    fun `folders and albums are not tracks`() {
        assertNull(MediaIds.trackhashOf(MediaRef.Album("al9")))
        assertNull(MediaIds.scrobbleSource(MediaRef.Album("al9")))
        assertNull(MediaIds.trackhashOf(MediaRef.Mixes))
    }
}
