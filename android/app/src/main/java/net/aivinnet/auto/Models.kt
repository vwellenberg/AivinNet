package net.aivinnet.auto

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/** Tokens returned by `POST /auth/login` and `POST /auth/refresh` (same shape). */
data class LoginResult(
    val accessToken: String,
    val refreshToken: String,
    val maxAge: Long,
)

/** One entry of `GET /playlists?no_images=true` (`{"data": [...]}`). */
data class PlaylistSummary(
    val id: String,
    val name: String,
    val count: Int,
    /** The user pinned it on the server; the car lists pinned playlists first. Missing in old answers: false. */
    val pinned: Boolean = false,
    /**
     * The file name of the playlist's own cover (`<id>.webp`), or null when it has none. The server's
     * `image` is then the name, and `has_image` says whether the file exists; without an image the
     * server sends the placeholder text "None", which is not a name.
     */
    val coverImage: String? = null,
)

/** One track of `GET /playlists/<id>?limit=-1`, as serialised by serializers/track.py. */
data class TrackInfo(
    val trackhash: String,
    val title: String,
    val album: String,
    val artists: List<String>,
    val duration: Int,
    val filepath: String,
    val image: String,
)

/**
 * One album of `GET /search/?itemtype=albums`, as serialized by serializers/album.py. [image] has the
 * same `<albumhash>.webp?pathhash=<hash>` form as a track's, so the track cover rules read it.
 */
data class AlbumSummary(
    val albumhash: String,
    val title: String,
    val artists: List<String>,
    val image: String,
)

/** `GET /playlists/<id>?limit=-1`: `info.name` plus the resolvable tracks. */
data class PlaylistDetail(
    val id: String,
    val name: String,
    val tracks: List<TrackInfo>,
)

/** One play for `POST /logger/track/log`. `timestamp` is unix seconds at the end of the play. */
data class ScrobblePlay(
    val trackhash: String,
    val timestamp: Long,
    val duration: Int,
    val source: String,
)

/** Parses the JSON bodies of the AivinNet API. Pure, so it runs in JVM unit tests. */
object AivinJson {

    /**
     * A 200 that is not our JSON (a captive portal, a proxy's error page, a wrong URL) must
     * surface as an [AivinException] — an IOException the callers already handle — and not as
     * a JSONException, which is a RuntimeException and would crash the app or the service.
     */
    private inline fun <T> parsing(block: () -> T): T = try {
        block()
    } catch (e: JSONException) {
        throw AivinException("Unerwartete Antwort vom Server – stimmt die Server-URL?")
    }

    fun parseLogin(body: String): LoginResult = parsing {
        val json = JSONObject(body)
        LoginResult(
            accessToken = json.getString("accesstoken"),
            refreshToken = json.getString("refreshtoken"),
            maxAge = json.optLong("maxage", 0L),
        )
    }

    /** `GET /ratings/<trackhash>` → `{"rating": n | null}`. */
    fun parseRating(body: String): Int? = parsing {
        val json = JSONObject(body)
        if (json.isNull("rating")) null else json.getInt("rating")
    }

    fun parsePlaylists(body: String): List<PlaylistSummary> = parsing {
        val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
        (0 until data.length()).map { index ->
            val playlist = data.getJSONObject(index)
            PlaylistSummary(
                id = playlist.get("id").toString(),
                name = playlist.optString("name", ""),
                count = playlist.optInt("count", 0),
                pinned = playlist.optBoolean("pinned", false),
                coverImage = playlist.optString("image", "")
                    .takeIf { playlist.optBoolean("has_image", false) && it.isNotBlank() && it != "None" },
            )
        }
    }

    fun parsePlaylistDetail(id: String, body: String): PlaylistDetail = parsing {
        val json = JSONObject(body)
        val name = json.optJSONObject("info")?.optString("name", "").orEmpty()
        val tracks = json.optJSONArray("tracks") ?: JSONArray()
        PlaylistDetail(
            id = id,
            name = name.ifEmpty { id },
            tracks = (0 until tracks.length()).map { parseTrack(tracks.getJSONObject(it)) },
        )
    }

    /** `GET /search/?itemtype=tracks&q=…`: `{"results": [track, …], "more": bool}`. */
    fun parseSearchTracks(body: String): List<TrackInfo> = parsing {
        trackArray(JSONObject(body).optJSONArray("results") ?: JSONArray())
    }

    /** `GET /search/?itemtype=albums&q=…`: `{"results": [album, …], "more": bool}`. */
    fun parseSearchAlbums(body: String): List<AlbumSummary> = parsing {
        val results = JSONObject(body).optJSONArray("results") ?: JSONArray()
        (0 until results.length()).map { index ->
            val album = results.getJSONObject(index)
            val artists = album.optJSONArray("albumartists") ?: JSONArray()
            AlbumSummary(
                albumhash = album.getString("albumhash"),
                title = album.optString("title", ""),
                artists = (0 until artists.length())
                    .mapNotNull { artists.optJSONObject(it)?.optString("name", "") }
                    .filter { it.isNotBlank() },
                image = album.optString("image", ""),
            )
        }
    }

    /** `GET /album/<albumhash>/tracks`: a bare JSON array of tracks. */
    fun parseTrackList(body: String): List<TrackInfo> = parsing {
        trackArray(JSONArray(body))
    }

    private fun trackArray(tracks: JSONArray): List<TrackInfo> =
        (0 until tracks.length()).map { parseTrack(tracks.getJSONObject(it)) }

    private fun parseTrack(track: JSONObject): TrackInfo {
        val artists = track.optJSONArray("artists") ?: JSONArray()
        return TrackInfo(
            trackhash = track.getString("trackhash"),
            title = track.optString("title", ""),
            album = track.optString("album", ""),
            artists = (0 until artists.length())
                .mapNotNull { artists.optJSONObject(it)?.optString("name", "") }
                .filter { it.isNotBlank() },
            duration = track.optInt("duration", 0),
            filepath = track.getString("filepath"),
            image = track.optString("image", ""),
        )
    }
}
