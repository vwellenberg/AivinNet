package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class VoiceRulesTest {

    private fun track(hash: String) = TrackInfo(
        trackhash = hash,
        title = "Title $hash",
        album = "",
        artists = emptyList(),
        duration = 100,
        filepath = "music/$hash.mp3",
        image = "",
    )

    private fun album(hash: String) = AlbumSummary(hash, "Album $hash", listOf("Anna"), image = "")

    @Test
    fun `a query with tracks plays the tracks, even when an album matches too`() {
        val tracks = listOf(track("a"), track("b"))

        assertEquals(VoicePick.Tracks(tracks), VoiceRules.pickForQuery(tracks, listOf(album("al1"))))
    }

    @Test
    fun `without tracks the first album plays`() {
        assertEquals(VoicePick.Album("al2"), VoiceRules.pickForQuery(emptyList(), listOf(album("al2"), album("al3"))))
    }

    @Test
    fun `nothing matched is no pick`() {
        assertEquals(VoicePick.None, VoiceRules.pickForQuery(emptyList(), emptyList()))
    }

    @Test
    fun `the empty request plays the first mix, as that playlist`() {
        val mix = PlaylistDetail("mix1", "Mix 1", listOf(track("m1")))
        val offline = listOf(PlaylistDetail("42", "Chill", listOf(track("o1"))))

        assertEquals(VoicePick.Playlist("mix1", mix.tracks), VoiceRules.pickForEmptyQuery(mix, offline))
    }

    @Test
    fun `without a mix the first offline list with tracks plays as itself, skipping empty ones`() {
        val offline = listOf(
            PlaylistDetail("1", "Leer", emptyList()),
            PlaylistDetail("2", "Roadtrip", listOf(track("o2"))),
            PlaylistDetail("3", "Chill", listOf(track("o3"))),
        )

        assertEquals(VoicePick.Playlist("2", listOf(track("o2"))), VoiceRules.pickForEmptyQuery(null, offline))
    }

    @Test
    fun `an empty mix does not count`() {
        val mix = PlaylistDetail("mix1", "Mix 1", emptyList())
        assertEquals(VoicePick.None, VoiceRules.pickForEmptyQuery(mix, listOf(PlaylistDetail("1", "Leer", emptyList()))))
    }
}
