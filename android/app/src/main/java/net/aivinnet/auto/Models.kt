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

    fun parsePlaylists(body: String): List<PlaylistSummary> = parsing {
        val data = JSONObject(body).optJSONArray("data") ?: JSONArray()
        (0 until data.length()).map { index ->
            val playlist = data.getJSONObject(index)
            PlaylistSummary(
                id = playlist.get("id").toString(),
                name = playlist.optString("name", ""),
                count = playlist.optInt("count", 0),
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
