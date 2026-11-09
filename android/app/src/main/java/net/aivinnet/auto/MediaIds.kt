package net.aivinnet.auto

/** What a media id in the browse tree points at. */
sealed interface MediaRef {
    data object Root : MediaRef
    data object Mixes : MediaRef
    data object Playlists : MediaRef
    data class Playlist(val id: String) : MediaRef
    data class Track(val playlistId: String, val trackhash: String) : MediaRef

    /** An offline playlist, listed from its snapshot with only the downloaded tracks (no network). */
    data class OfflinePlaylist(val id: String) : MediaRef
    data object Offline : MediaRef
    data object Unknown : MediaRef
}

/**
 * Media ids of the browse tree:
 *  - `root`, `mixes`, `playlists`, `offline` (folders)
 *  - `pl:<playlistid>` (a playlist; numeric, or `mix1`..`mix4` for generated mixes)
 *  - `off:<playlistid>` (an offline playlist, from its snapshot: only downloaded tracks)
 *  - `tr:<playlistid>:<trackhash>` (a track inside a playlist)
 *
 * Playlist ids never contain a colon and trackhashes are hex, so the split is unambiguous.
 */
object MediaIds {
    const val ROOT = "root"
    const val MIXES = "mixes"
    const val PLAYLISTS = "playlists"
    const val OFFLINE = "offline"

    /** Generated mixes; each answers 404 or no tracks when the user has none. */
    val MIX_IDS: List<String> = listOf("mix1", "mix2", "mix3", "mix4")

    private const val PLAYLIST_PREFIX = "pl:"
    private const val OFFLINE_PREFIX = "off:"
    private const val TRACK_PREFIX = "tr:"

    fun playlist(id: String): String = PLAYLIST_PREFIX + id

    fun offlinePlaylist(id: String): String = OFFLINE_PREFIX + id

    fun track(playlistId: String, trackhash: String): String = "$TRACK_PREFIX$playlistId:$trackhash"

    fun parse(mediaId: String?): MediaRef = when {
        mediaId == null -> MediaRef.Unknown
        mediaId == ROOT -> MediaRef.Root
        mediaId == MIXES -> MediaRef.Mixes
        mediaId == PLAYLISTS -> MediaRef.Playlists
        mediaId == OFFLINE -> MediaRef.Offline
        mediaId.startsWith(OFFLINE_PREFIX) -> {
            val id = mediaId.removePrefix(OFFLINE_PREFIX)
            if (id.isNotEmpty() && ':' !in id) MediaRef.OfflinePlaylist(id) else MediaRef.Unknown
        }
        mediaId.startsWith(PLAYLIST_PREFIX) -> {
            val id = mediaId.removePrefix(PLAYLIST_PREFIX)
            if (id.isNotEmpty() && ':' !in id) MediaRef.Playlist(id) else MediaRef.Unknown
        }
        mediaId.startsWith(TRACK_PREFIX) -> {
            val rest = mediaId.removePrefix(TRACK_PREFIX)
            val playlistId = rest.substringBefore(':', "")
            val trackhash = rest.substringAfter(':', "")
            if (playlistId.isNotEmpty() && trackhash.isNotEmpty() && ':' !in trackhash) {
                MediaRef.Track(playlistId, trackhash)
            } else {
                MediaRef.Unknown
            }
        }
        else -> MediaRef.Unknown
    }
}
