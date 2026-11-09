package net.aivinnet.auto

import java.io.File
import org.json.JSONArray
import org.json.JSONObject

/**
 * What is offline, per account. [accounts] maps an account key ([SessionStore.accountKey]) to its
 * offline playlists: id → snapshot as last synced, or null before the first successful sync.
 *
 * Playlist ids belong to one user (`mix1` is a different mix for every account), so the account is
 * part of the key. Tracks are not: a download is keyed by trackhash and shared by all accounts.
 */
data class OfflineState(
    val allowMobile: Boolean = false,
    val accounts: Map<String, Map<String, PlaylistDetail?>> = emptyMap(),
) {
    fun offlineIds(account: String): Set<String> = accounts[account]?.keys.orEmpty()

    fun snapshots(account: String): Map<String, PlaylistDetail?> = accounts[account].orEmpty()

    /** Every snapshot of every account: a track any of them still lists must stay on disk. */
    fun allSnapshots(): List<PlaylistDetail> = accounts.values.flatMap { it.values.filterNotNull() }

    fun withOffline(account: String, id: String): OfflineState =
        changeAccount(account) { if (id in it) it else it + (id to null) }

    fun withoutOffline(account: String, id: String): OfflineState =
        changeAccount(account) { it - id }

    /** Only for an id that is still offline: a sync that finishes after an unmark must not re-add it. */
    fun withSnapshot(account: String, id: String, detail: PlaylistDetail): OfflineState =
        changeAccount(account) { if (id in it) it + (id to detail) else it }

    private fun changeAccount(
        account: String,
        change: (Map<String, PlaylistDetail?>) -> Map<String, PlaylistDetail?>,
    ): OfflineState {
        val updated = change(accounts[account].orEmpty())
        val next = if (updated.isEmpty()) accounts - account else accounts + (account to updated)
        return copy(accounts = next)
    }
}

/**
 * JSON for the on-disk documents. Pure, so the round trip is tested on the JVM. Field names are
 * part of the file format: change them only with a migration.
 */
object OfflineJson {
    private const val VERSION = 1

    fun encodeState(state: OfflineState): String {
        val accounts = JSONObject()
        for ((account, playlists) in state.accounts) {
            val obj = JSONObject()
            for ((id, detail) in playlists) {
                obj.put(id, detail?.let { encodePlaylist(it) } ?: JSONObject.NULL)
            }
            accounts.put(account, obj)
        }
        return JSONObject()
            .put("version", VERSION)
            .put("allowMobile", state.allowMobile)
            .put("accounts", accounts)
            .toString()
    }

    fun decodeState(text: String): OfflineState {
        val json = JSONObject(text)
        val accountsJson = json.optJSONObject("accounts") ?: JSONObject()
        val accounts = LinkedHashMap<String, Map<String, PlaylistDetail?>>()
        for (account in accountsJson.keys().asSequence().toList()) {
            val obj = accountsJson.getJSONObject(account)
            val playlists = LinkedHashMap<String, PlaylistDetail?>()
            for (id in obj.keys().asSequence().toList()) {
                playlists[id] = if (obj.isNull(id)) null else decodePlaylist(obj.getJSONObject(id))
            }
            accounts[account] = playlists
        }
        return OfflineState(allowMobile = json.optBoolean("allowMobile", false), accounts = accounts)
    }

    fun encodeQueue(entries: List<QueuedPlay>): String {
        val plays = JSONArray()
        for (entry in entries) {
            plays.put(
                JSONObject()
                    .put("owner", entry.owner)
                    .put("trackhash", entry.play.trackhash)
                    .put("timestamp", entry.play.timestamp)
                    .put("duration", entry.play.duration)
                    .put("source", entry.play.source),
            )
        }
        return JSONObject().put("version", VERSION).put("plays", plays).toString()
    }

    fun decodeQueue(text: String): List<QueuedPlay> {
        val plays = JSONObject(text).getJSONArray("plays")
        return (0 until plays.length()).map { index ->
            val obj = plays.getJSONObject(index)
            QueuedPlay(
                owner = obj.getString("owner"),
                play = ScrobblePlay(
                    trackhash = obj.getString("trackhash"),
                    timestamp = obj.getLong("timestamp"),
                    duration = obj.getInt("duration"),
                    source = obj.getString("source"),
                ),
            )
        }
    }

    private fun encodePlaylist(detail: PlaylistDetail): JSONObject {
        val tracks = JSONArray()
        detail.tracks.forEach { tracks.put(encodeTrack(it)) }
        return JSONObject()
            .put("id", detail.id)
            .put("name", detail.name)
            .put("tracks", tracks)
    }

    private fun decodePlaylist(obj: JSONObject): PlaylistDetail {
        val tracks = obj.getJSONArray("tracks")
        return PlaylistDetail(
            id = obj.getString("id"),
            name = obj.optString("name", ""),
            tracks = (0 until tracks.length()).map { decodeTrack(tracks.getJSONObject(it)) },
        )
    }

    private fun encodeTrack(track: TrackInfo): JSONObject = JSONObject()
        .put("trackhash", track.trackhash)
        .put("title", track.title)
        .put("album", track.album)
        .put("artists", JSONArray(track.artists))
        .put("duration", track.duration)
        .put("filepath", track.filepath)
        .put("image", track.image)

    private fun decodeTrack(obj: JSONObject): TrackInfo {
        val artists = obj.optJSONArray("artists") ?: JSONArray()
        return TrackInfo(
            trackhash = obj.getString("trackhash"),
            title = obj.optString("title", ""),
            album = obj.optString("album", ""),
            artists = (0 until artists.length()).map { artists.getString(it) },
            duration = obj.optInt("duration", 0),
            filepath = obj.getString("filepath"),
            image = obj.optString("image", ""),
        )
    }
}

/** The offline state on disk. [update] is the only way to change it. */
class OfflineStore(file: File, log: ErrorLog) {
    private val json = JsonFile(file, OfflineState(), OfflineJson::decodeState, OfflineJson::encodeState, log)

    fun load(): OfflineState = json.load()

    fun update(change: (OfflineState) -> OfflineState): OfflineState = json.update(change)
}
