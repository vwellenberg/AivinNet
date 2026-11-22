package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Bodies modelled on what api/search.py (`{"results": [...], "more": bool}`) and api/album.py
 * (`GET /album/<hash>/tracks`, a bare array) produce, through serializers/track.py and album.py.
 */
class AivinJsonSearchTest {

    private val trackJson = """
        {"trackhash":"9f8e7d6c5b4a3210","title":"Nightcall","album":"Nightcall EP",
         "artists":[{"name":"Kavinsky","artisthash":"a1"},{"name":"Lovefoxxx","artisthash":"a2"}],
         "albumartists":[{"name":"Kavinsky","artisthash":"a1"}],
         "duration":257,"filepath":"Kavinsky/Nightcall EP/01 Nightcall.flac",
         "image":"b2c3d4e5.webp?pathhash=f00d&fb=track","albumhash":"b2c3d4e5",
         "trackno":1,"rating":null,"year":2010,"is_favorite":false,"playcount":3}
    """.trimIndent()

    private val albumJson = """
        {"albumhash":"b2c3d4e5","title":"Nightcall EP",
         "albumartists":[{"name":"Kavinsky","artisthash":"a1"}],
         "image":"b2c3d4e5.webp?pathhash=f00d","pathhash":"f00d","type":"album","date":1262304000}
    """.trimIndent()

    @Test
    fun `parses the track results of the search`() {
        val body = """{"results":[$trackJson],"more":false}"""

        val tracks = AivinJson.parseSearchTracks(body)

        assertEquals(1, tracks.size)
        val track = tracks.single()
        assertEquals("9f8e7d6c5b4a3210", track.trackhash)
        assertEquals("Nightcall", track.title)
        assertEquals("Nightcall EP", track.album)
        assertEquals(listOf("Kavinsky", "Lovefoxxx"), track.artists)
        assertEquals(257, track.duration)
        assertEquals("Kavinsky/Nightcall EP/01 Nightcall.flac", track.filepath)
        assertEquals("b2c3d4e5.webp?pathhash=f00d&fb=track", track.image)
    }

    @Test
    fun `parses the album results of the search`() {
        val body = """{"results":[$albumJson],"more":false}"""

        val albums = AivinJson.parseSearchAlbums(body)

        assertEquals(
            listOf(AlbumSummary("b2c3d4e5", "Nightcall EP", listOf("Kavinsky"), "b2c3d4e5.webp?pathhash=f00d")),
            albums,
        )
    }

    @Test
    fun `an empty search answers an empty list`() {
        assertEquals(emptyList<TrackInfo>(), AivinJson.parseSearchTracks("""{"results":[],"more":false}"""))
        assertEquals(emptyList<AlbumSummary>(), AivinJson.parseSearchAlbums("""{"results":[],"more":false}"""))
    }

    @Test
    fun `parses the album's tracks from the bare array`() {
        val body = "[$trackJson]"

        val tracks = AivinJson.parseTrackList(body)

        assertEquals(listOf("9f8e7d6c5b4a3210"), tracks.map { it.trackhash })
    }

    @Test
    fun `a search answer that is not our JSON fails as an IO error, not a crash`() {
        assertThrows(AivinException::class.java) {
            AivinJson.parseSearchTracks("<html>Proxy error</html>")
        }
        assertThrows(AivinException::class.java) {
            AivinJson.parseTrackList("""{"results":[]}""")
        }
    }
}
