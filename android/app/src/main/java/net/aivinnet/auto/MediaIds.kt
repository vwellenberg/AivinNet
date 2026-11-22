package net.aivinnet.auto

/** What a media id in the browse tree points at. */
sealed interface MediaRef {
    data object Root : MediaRef
    data object Mixes : MediaRef
    data object Playlists : MediaRef
    data object Home : MediaRef
    data class Playlist(val id: String) : MediaRef
    data class Track(val playlistId: String, val trackhash: String) : MediaRef

    /** A track from a search result (`st:<trackhash>`). Its queue is the search's track list, from this track on. */
    data class SearchTrack(val trackhash: String) : MediaRef

    /** An album from a search result (`al:<albumhash>`), browsable: it lists the album's tracks. */
    data class Album(val albumhash: String) : MediaRef

    /** A track inside an album (`at:<albumhash>:<trackhash>`). Its queue is the album's tracks, from this one on. */
    data class AlbumTrack(val albumhash: String, val trackhash: String) : MediaRef

    /** An offline playlist, listed from its snapshot with only the downloaded tracks (no network). */
    data class OfflinePlaylist(val id: String) : MediaRef
    data object Offline : MediaRef
    data object Unknown : MediaRef
}

/**
 * Media ids of the browse tree:
 *  - `root`, `home`, `mixes`, `playlists`, `offline` (folders; the root's children are the tabs)
 *  - `pl:<playlistid>` (a playlist; numeric, or `mix1`..`mix4` for generated mixes)
 *  - `off:<playlistid>` (an offline playlist, from its snapshot: only downloaded tracks)
 *  - `tr:<playlistid>:<trackhash>` (a track inside a playlist)
 *  - `st:<trackhash>` (a track of the last search results; the queue is that search's track list)
 *  - `al:<albumhash>` (an album of the search results; browsable, lists its tracks)
 *  - `at:<albumhash>:<trackhash>` (a track inside such an album)
 *
 * Playlist ids never contain a colon and trackhashes are hex, so the split is unambiguous.
 */
object MediaIds {
    const val ROOT = "root"
    const val MIXES = "mixes"
    const val PLAYLISTS = "playlists"
    const val OFFLINE = "offline"

    const val HOME = "home"

    /** Generated mixes; each answers 404 or no tracks when the user has none. */
    val MIX_IDS: List<String> = listOf("mix1", "mix2", "mix3", "mix4")

    /**
     * The Home rows that are playlists on the server, in the order the car lists them. This order is
     * the car's own: the web Home's order is chosen per user (Settings → Home). The ids mirror
     * `CUSTOM_PLAYLISTS` in `src/aivinnet/lib/home/homerows.py` and the handlers in
     * `lib/home/generated_playlists.py`.
     */
    val HOME_IDS: List<String> = listOf(
        "becauseyoulistened",
        "onrepeat",
        "toprated",
        "recentlyplayed",
        "forgottenfavorites",
        "deepcuts",
        "onthisday",
        "almostcomplete",
        "recentlyadded",
    )

    /**
     * The stations of the radio: genres, decades and the seasonal ones. Mirrors `STATION_PLAYLIST_IDS`
     * in `src/aivinnet/lib/home/stations.py`. A station the user has no tracks for answers 404 or empty.
     */
    val STATION_IDS: List<String> = listOf(
        "genre1", "genre2", "genre3", "genre4",
        "decade1", "decade2", "decade3", "decade4",
        "christmas", "countdown",
    )

    private const val PLAYLIST_PREFIX = "pl:"
    private const val OFFLINE_PREFIX = "off:"
    private const val TRACK_PREFIX = "tr:"
    private const val SEARCH_TRACK_PREFIX = "st:"
    private const val ALBUM_PREFIX = "al:"
    private const val ALBUM_TRACK_PREFIX = "at:"

    /** The scrobble source of a search: the server's `q:` kind, without the query text. */
    private const val SEARCH_SOURCE = "q:"

    /** Whether [id] is a playlist the server generates (a mix, a home row or a station), not one the user made. */
    fun isGenerated(id: String): Boolean = id in MIX_IDS || id in STATION_IDS || id in HOME_IDS

    fun playlist(id: String): String = PLAYLIST_PREFIX + id

    fun offlinePlaylist(id: String): String = OFFLINE_PREFIX + id

    fun track(playlistId: String, trackhash: String): String = "$TRACK_PREFIX$playlistId:$trackhash"

    fun searchTrack(trackhash: String): String = SEARCH_TRACK_PREFIX + trackhash

    /**
     * The trackhash of a track ref, whichever list it came from; null for everything that is not a track.
     * The scrobbler and the rating button use this, so a track from a search or an album counts like any other.
     */
    fun trackhashOf(ref: MediaRef): String? = when (ref) {
        is MediaRef.Track -> ref.trackhash
        is MediaRef.SearchTrack -> ref.trackhash
        is MediaRef.AlbumTrack -> ref.trackhash
        else -> null
    }

    /**
     * The play source a scrobble of [ref] is sent with, in the server's form (`listening_sources.py`): `pl:<id>`
     * for a playlist, `al:<albumhash>` for an album, `q:` for a search. Null for anything that is not a track.
     * A search's query is not sent: the source only says that the play came from a search.
     */
    fun scrobbleSource(ref: MediaRef): String? = when (ref) {
        is MediaRef.Track -> PLAYLIST_PREFIX + ref.playlistId
        is MediaRef.AlbumTrack -> "al:${ref.albumhash}"
        is MediaRef.SearchTrack -> SEARCH_SOURCE
        else -> null
    }

    fun album(albumhash: String): String = ALBUM_PREFIX + albumhash

    fun albumTrack(albumhash: String, trackhash: String): String = "$ALBUM_TRACK_PREFIX$albumhash:$trackhash"

    fun parse(mediaId: String?): MediaRef = when {
        mediaId == null -> MediaRef.Unknown
        mediaId == ROOT -> MediaRef.Root
        mediaId == MIXES -> MediaRef.Mixes
        mediaId == PLAYLISTS -> MediaRef.Playlists
        mediaId == HOME -> MediaRef.Home
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
        mediaId.startsWith(SEARCH_TRACK_PREFIX) -> {
            val trackhash = mediaId.removePrefix(SEARCH_TRACK_PREFIX)
            if (trackhash.isNotEmpty() && ':' !in trackhash) MediaRef.SearchTrack(trackhash) else MediaRef.Unknown
        }
        mediaId.startsWith(ALBUM_TRACK_PREFIX) -> {
            val rest = mediaId.removePrefix(ALBUM_TRACK_PREFIX)
            val albumhash = rest.substringBefore(':', "")
            val trackhash = rest.substringAfter(':', "")
            if (albumhash.isNotEmpty() && trackhash.isNotEmpty() && ':' !in trackhash) {
                MediaRef.AlbumTrack(albumhash, trackhash)
            } else {
                MediaRef.Unknown
            }
        }
        mediaId.startsWith(ALBUM_PREFIX) -> {
            val albumhash = mediaId.removePrefix(ALBUM_PREFIX)
            if (albumhash.isNotEmpty() && ':' !in albumhash) MediaRef.Album(albumhash) else MediaRef.Unknown
        }
        else -> MediaRef.Unknown
    }
}
