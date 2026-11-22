package net.aivinnet.auto

/** What a voice request ("spiel Nightcall auf AivinNet") plays. */
sealed interface VoicePick {
    /** Play [tracks] as the queue, from the first one. */
    data class Tracks(val tracks: List<TrackInfo>) : VoicePick

    /**
     * A playlist plays as itself (the empty request: a mix, or an offline list): its own track ids, so
     * the plays count for that playlist and next/previous find the tracks.
     */
    data class Playlist(val id: String, val tracks: List<TrackInfo>) : VoicePick

    /** No track matched, but this album did: play its tracks. */
    data class Album(val albumhash: String) : VoicePick

    /** Nothing to play. */
    data object None : VoicePick
}

/**
 * The choices behind a voice request. Pure, so the order of the fallbacks is tested without Media3 or
 * the network. The service does the fetching and hands the results in.
 */
object VoiceRules {

    /**
     * A query with tracks plays them, the best match first (the server ranks, and so do the offline rules).
     * Without tracks, the first album plays. Nothing matched: [VoicePick.None].
     */
    fun pickForQuery(tracks: List<TrackInfo>, albums: List<AlbumSummary>): VoicePick = when {
        tracks.isNotEmpty() -> VoicePick.Tracks(tracks)
        albums.isNotEmpty() -> VoicePick.Album(albums.first().albumhash)
        else -> VoicePick.None
    }

    /**
     * The empty request ("spiel AivinNet", no query): the first mix that has tracks. Without one (no network,
     * or the mix is empty for this user), the first offline list that has something playable. [offlineLists]
     * arrives in the order the car lists them.
     */
    fun pickForEmptyQuery(mix: PlaylistDetail?, offlineLists: List<PlaylistDetail>): VoicePick {
        if (mix != null && mix.tracks.isNotEmpty()) return VoicePick.Playlist(mix.id, mix.tracks)
        val offline = offlineLists.firstOrNull { it.tracks.isNotEmpty() } ?: return VoicePick.None
        return VoicePick.Playlist(offline.id, offline.tracks)
    }
}
