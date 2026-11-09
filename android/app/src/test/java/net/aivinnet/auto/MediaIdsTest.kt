package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class MediaIdsTest {

    @Test
    fun `formats playlist and track ids`() {
        assertEquals("pl:7", MediaIds.playlist("7"))
        assertEquals("pl:mix1", MediaIds.playlist("mix1"))
        assertEquals("tr:7:9f8e7d6c5b4a3210", MediaIds.track("7", "9f8e7d6c5b4a3210"))
    }

    @Test
    fun `parses folders`() {
        assertEquals(MediaRef.Root, MediaIds.parse("root"))
        assertEquals(MediaRef.Mixes, MediaIds.parse("mixes"))
        assertEquals(MediaRef.Playlists, MediaIds.parse("playlists"))
    }

    @Test
    fun `parses a playlist, including a generated mix`() {
        assertEquals(MediaRef.Playlist("7"), MediaIds.parse("pl:7"))
        assertEquals(MediaRef.Playlist("mix2"), MediaIds.parse("pl:mix2"))
    }

    @Test
    fun `parses a track into playlist and trackhash`() {
        assertEquals(
            MediaRef.Track("mix1", "abc123def456"),
            MediaIds.parse("tr:mix1:abc123def456"),
        )
    }

    @Test
    fun `round trips format and parse`() {
        val id = MediaIds.track("12", "0123456789abcdef")
        assertEquals(MediaRef.Track("12", "0123456789abcdef"), MediaIds.parse(id))
        assertEquals(MediaRef.Playlist("12"), MediaIds.parse(MediaIds.playlist("12")))
    }

    @Test
    fun `rejects malformed ids`() {
        assertEquals(MediaRef.Unknown, MediaIds.parse(null))
        assertEquals(MediaRef.Unknown, MediaIds.parse(""))
        assertEquals(MediaRef.Unknown, MediaIds.parse("pl:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("tr:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("tr:7"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("tr:7:"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("tr::hash"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("tr:7:a:b"))
        assertEquals(MediaRef.Unknown, MediaIds.parse("something-else"))
    }
}
