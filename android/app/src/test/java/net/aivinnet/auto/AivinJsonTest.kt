package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * Bodies modelled on what api/auth.py, api/playlist.py and serializers/track.py produce.
 * `image` carries the `?pathhash=` suffix, as Album.image does.
 */
class AivinJsonTest {

    @Test
    fun `parses login and refresh responses`() {
        val body = """
            {"msg":"Logged in as anna","accesstoken":"eyJhbGciOi.access.sig",
             "refreshtoken":"eyJhbGciOi.refresh.sig","maxage":900}
        """.trimIndent()

        val tokens = AivinJson.parseLogin(body)

        assertEquals("eyJhbGciOi.access.sig", tokens.accessToken)
        assertEquals("eyJhbGciOi.refresh.sig", tokens.refreshToken)
        assertEquals(900L, tokens.maxAge)
    }

    @Test
    fun `login without tokens fails loudly`() {
        assertThrows(org.json.JSONException::class.java) {
            AivinJson.parseLogin("""{"msg":"User not found"}""")
        }
    }

    @Test
    fun `parses the playlist list from the data array`() {
        val body = """
            {"data":[
              {"id":7,"name":"Roadtrip","count":3,"has_image":true,"image":"a1b2c3d4.webp?pathhash=a1b2c3d4"},
              {"id":12,"name":"Ruhig & Leise","count":0,"has_image":false}
            ]}
        """.trimIndent()

        val playlists = AivinJson.parsePlaylists(body)

        assertEquals(listOf("7", "12"), playlists.map { it.id })
        assertEquals(listOf("Roadtrip", "Ruhig & Leise"), playlists.map { it.name })
        assertEquals(listOf(3, 0), playlists.map { it.count })
    }

    @Test
    fun `parses the playlist detail with tracks and artists`() {
        val body = """
            {"info":{"id":7,"name":"Roadtrip","count":2,"trackhashes":null},
             "tracks":[
               {"trackhash":"9f8e7d6c5b4a3210","title":"Für Elise","album":"Klavier Ö",
                "albumhash":"0011223344556677","artists":[{"name":"Beethoven","artisthash":"aa"},
                {"name":"Ärzte Quartett","artisthash":"bb"}],"duration":215,
                "filepath":"/music/Beethoven/Für Elise.flac",
                "image":"0011223344556677.webp?pathhash=0011223344556677","track":1,"disc":1,
                "playcount":4,"is_favorite":false},
               {"trackhash":"1122334455667788","title":"Mondschein","album":"Sonaten","artists":[],
                "duration":300,"filepath":"/music/Mondschein.mp3","image":""}
             ]}
        """.trimIndent()

        val detail = AivinJson.parsePlaylistDetail("7", body)

        assertEquals("7", detail.id)
        assertEquals("Roadtrip", detail.name)
        assertEquals(2, detail.tracks.size)

        val first = detail.tracks[0]
        assertEquals("9f8e7d6c5b4a3210", first.trackhash)
        assertEquals("Für Elise", first.title)
        assertEquals("Klavier Ö", first.album)
        assertEquals(listOf("Beethoven", "Ärzte Quartett"), first.artists)
        assertEquals(215, first.duration)
        assertEquals("/music/Beethoven/Für Elise.flac", first.filepath)
        assertEquals("0011223344556677.webp?pathhash=0011223344556677", first.image)

        assertEquals(emptyList<String>(), detail.tracks[1].artists)
    }

    @Test
    fun `playlist detail without a name falls back to the id`() {
        val detail = AivinJson.parsePlaylistDetail("mix3", """{"info":{},"tracks":[]}""")

        assertEquals("mix3", detail.name)
        assertEquals(emptyList<TrackInfo>(), detail.tracks)
    }

    @Test
    fun `skips artist entries without a name`() {
        val body = """
            {"info":{"name":"X"},"tracks":[{"trackhash":"h","title":"t","album":"a",
             "artists":[{"artisthash":"zz"},{"name":"  "},{"name":"Echt"}],
             "duration":1,"filepath":"/f.mp3"}]}
        """.trimIndent()

        assertEquals(listOf("Echt"), AivinJson.parsePlaylistDetail("1", body).tracks.single().artists)
    }
}
