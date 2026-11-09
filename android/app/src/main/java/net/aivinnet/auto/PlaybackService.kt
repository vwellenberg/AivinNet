package net.aivinnet.auto

import android.content.Intent
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionError
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.IOException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch

/**
 * The media service Android Auto browses and plays from. The phone UI is only the login screen.
 *
 * Browse tree: root → "mixes" / "playlists" → playlist (`pl:<id>`) → track (`tr:<id>:<hash>`).
 * A chosen track sets the whole playlist as the queue, so next and previous work.
 *
 * Media3's session and library APIs are all marked @UnstableApi. Media3 documents them as the
 * supported surface for media apps, so the marker goes on the class.
 */
@UnstableApi
class PlaybackService : MediaLibraryService() {

    private lateinit var api: AivinApi
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession

    /** Browse and resolve calls. Cancelled in onDestroy. */
    private lateinit var browseScope: CoroutineScope

    /**
     * Scrobbles are fire-and-forget and must still go out during shutdown, so this scope is
     * never cancelled. Each request is bounded by the client's 10 s timeouts.
     */
    private val scrobbleScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    private val scrobbler = Scrobbler()

    /** Playlists as last shown in the car, so a tap plays exactly that list. */
    private val playlists = PlaylistCache(now = SystemClock::elapsedRealtime)

    override fun onCreate() {
        super.onCreate()
        api = AivinApi.create(this)
        browseScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        // Downloaded tracks play from disk, the rest streams. The cache is read-only here, and that is
        // deliberate: it never evicts, so a stream written into it would grow with every track played.
        // Only the download service writes it. Streams keep the bearer and refresh logic of the API calls.
        val cacheFactory = CacheDataSource.Factory()
            .setCache(OfflineEngine.get(this).cache)
            .setUpstreamDataSourceFactory(OkHttpDataSource.Factory(api.authedClient))
            .setCacheWriteDataSinkFactory(null)
        player = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(cacheFactory))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true,
            )
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()
        player.addListener(scrobbler)

        session = MediaLibrarySession.Builder(this, player, LibraryCallback()).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    /** Stop the service when the app is swiped away and nothing is playing. Media3 standard. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        scrobbler.flush()
        session.release()
        player.release()
        browseScope.cancel()
        super.onDestroy()
    }

    // region Browse tree

    private inner class LibraryCallback : MediaLibrarySession.Callback {

        /**
         * The service is exported (Android Auto must bind to it), so any app on the phone can
         * connect. Only trusted callers may browse the library: the system (SystemUI, media
         * controls), Android Auto and this app. Everyone else — including legacy controllers
         * such as Bluetooth/AVRCP on older Android — gets the full player commands but no
         * session/library commands, so play/pause/next keep working without exposing the library.
         *
         * ⚠️ Commands are set explicitly on purpose. `AcceptedResultBuilder(session, controller)`
         * hands every controller that is not [MediaSession.ControllerInfo.isTrusted] (system or
         * MEDIA_CONTENT_CONTROL) Media3's *untrusted* defaults, and those are read-only: Android
         * Auto would then see the tree but could not start a track, and
         * `DEFAULT_UNTRUSTED_PLAYER_COMMANDS` cannot even pause (checked in Media3 1.11.1).
         */
        override fun onConnect(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
        ): MediaSession.ConnectionResult {
            val mayBrowse = ControllerTrust.mayBrowse(
                packageName = controller.packageName,
                packageVerified = controller.isPackageNameVerified,
                systemTrusted = controller.isTrusted,
                ownPackage = packageName,
            )
            val sessionCommands = if (mayBrowse) {
                MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
            } else {
                Log.i(TAG, "Player-only connection for ${controller.packageName}")
                SessionCommands.EMPTY
            }
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
                .build()
        }

        override fun onGetLibraryRoot(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<MediaItem>> = browseScope.future<LibraryResult<MediaItem>> {
            if (!api.isLoggedIn) {
                LibraryResult.ofError(SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED, params)
            } else {
                // TODO(#747): artwork. The image endpoint needs the bearer header and Android Auto
                // cannot send one, so covers need a signed or public URL first.
                LibraryResult.ofItem(folder(MediaIds.ROOT, getString(R.string.app_name)), params)
            }
        }

        override fun onGetChildren(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            parentId: String,
            page: Int,
            pageSize: Int,
            params: LibraryParams?,
        ): ListenableFuture<LibraryResult<ImmutableList<MediaItem>>> =
            browseScope.future<LibraryResult<ImmutableList<MediaItem>>> {
                try {
                    LibraryResult.ofItemList(Paging.slice(children(parentId), page, pageSize), params)
                } catch (e: Exception) {
                    errorResult(e, params)
                }
            }

        override fun onGetItem(
            session: MediaLibrarySession,
            browser: MediaSession.ControllerInfo,
            mediaId: String,
        ): ListenableFuture<LibraryResult<MediaItem>> =
            Futures.immediateFuture(
                LibraryResult.ofError(SessionError.ERROR_NOT_SUPPORTED),
            )

        /** Android Auto sends bare ids. Tracks get their stream URI here. */
        override fun onAddMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
        ): ListenableFuture<MutableList<MediaItem>> = browseScope.future {
            resolve(mediaItems).toMutableList()
        }

        /**
         * A single track sets its whole playlist as the queue, starting at that track, so next
         * and previous work. Several items are resolved one by one.
         */
        override fun onSetMediaItems(
            mediaSession: MediaSession,
            controller: MediaSession.ControllerInfo,
            mediaItems: MutableList<MediaItem>,
            startIndex: Int,
            startPositionMs: Long,
        ): ListenableFuture<MediaSession.MediaItemsWithStartPosition> = browseScope.future {
            val single = mediaItems.singleOrNull()?.let { MediaIds.parse(it.mediaId) } as? MediaRef.Track
            if (single != null) {
                val base = api.requireBaseUrl()
                // The list the car showed first; if the track is not in it (cache expired and the
                // mix was refilled meanwhile), one fresh fetch.
                var detail = playlist(single.playlistId)
                if (detail?.tracks?.none { it.trackhash == single.trackhash } != false) {
                    detail = playlist(single.playlistId, fresh = true)
                }
                detail ?: throw AivinException("Playlist nicht gefunden")
                val start = detail.tracks.indexOfFirst { it.trackhash == single.trackhash }
                if (start < 0) throw AivinException("Titel nicht in der Playlist")
                val queue = detail.tracks.map { playable(detail.id, it, base) }
                MediaSession.MediaItemsWithStartPosition(queue, start, C.TIME_UNSET)
            } else {
                val resolved = resolve(mediaItems)
                val index = if (resolved.isEmpty()) 0 else startIndex.coerceIn(0, resolved.lastIndex)
                MediaSession.MediaItemsWithStartPosition(resolved, index, startPositionMs)
            }
        }
    }

    private suspend fun children(parentId: String): List<MediaItem> = when (val ref = MediaIds.parse(parentId)) {
        MediaRef.Root -> listOf(
            folder(MediaIds.MIXES, getString(R.string.browse_mixes)),
            folder(MediaIds.PLAYLISTS, getString(R.string.browse_playlists)),
        )
        MediaRef.Mixes -> mixes()
        MediaRef.Playlists -> api.playlists().map { playlistItem(it.id, it.name, it.count) }
        is MediaRef.Playlist -> {
            // Opening a playlist always shows its current state; the tap then reuses this fetch.
            val detail = playlist(ref.id, fresh = true)
            detail?.tracks?.map { trackItem(detail.id, it) } ?: emptyList()
        }
        else -> emptyList()
    }

    /** Only the mixes the user actually has. A mix answers 404 or no tracks when it is missing. */
    private suspend fun mixes(): List<MediaItem> = coroutineScope {
        MediaIds.MIX_IDS
            .map { id -> async { playlist(id, fresh = true) } }
            .awaitAll()
            .filterNotNull()
            .filter { it.tracks.isNotEmpty() }
            .map { playlistItem(it.id, it.name, it.tracks.size) }
    }

    /** A playlist from the cache, or fetched (and cached) when [fresh] or not cached. */
    private suspend fun playlist(id: String, fresh: Boolean = false): PlaylistDetail? {
        if (!fresh) playlists.get(id)?.let { return it.detail }
        return api.playlist(id).also { playlists.put(id, it) }
    }

    /** Resolves bare ids to playable items with stream URIs. Unknown items are dropped. */
    private suspend fun resolve(items: List<MediaItem>): List<MediaItem> {
        val base = api.requireBaseUrl()
        val details = HashMap<String, PlaylistDetail?>()
        val out = ArrayList<MediaItem>(items.size)
        for (item in items) {
            val ref = MediaIds.parse(item.mediaId) as? MediaRef.Track ?: continue
            val detail = if (details.containsKey(ref.playlistId)) {
                details[ref.playlistId]
            } else {
                playlist(ref.playlistId).also { details[ref.playlistId] = it }
            }
            val track = detail?.tracks?.firstOrNull { it.trackhash == ref.trackhash } ?: continue
            out += playable(ref.playlistId, track, base)
        }
        return out
    }

    private fun errorResult(e: Exception, params: LibraryParams?): LibraryResult<ImmutableList<MediaItem>> {
        Log.w(TAG, "Browse failed", e)
        val code = when (e) {
            is AuthExpiredException -> SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED
            is IOException -> SessionError.ERROR_IO
            else -> SessionError.ERROR_NOT_SUPPORTED
        }
        return LibraryResult.ofError(code, params)
    }

    private fun folder(id: String, title: String): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .build(),
        )
        .build()

    private fun playlistItem(id: String, name: String, count: Int): MediaItem = MediaItem.Builder()
        .setMediaId(MediaIds.playlist(id))
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(name)
                .setSubtitle(resources.getQuantityString(R.plurals.track_count, count, count))
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                .build(),
        )
        .build()

    /** Browse entry: no URI yet. The URI is added when the track is chosen. */
    private fun trackItem(playlistId: String, track: TrackInfo): MediaItem = MediaItem.Builder()
        .setMediaId(MediaIds.track(playlistId, track.trackhash))
        .setMediaMetadata(metadataOf(track).setIsBrowsable(false).setIsPlayable(true).build())
        .build()

    /**
     * The cache key is the trackhash, so a download made under another filepath (or another server
     * address) is still found. Downloads use the same key, see [OfflineEngine.request].
     */
    private fun playable(playlistId: String, track: TrackInfo, base: String): MediaItem = MediaItem.Builder()
        .setMediaId(MediaIds.track(playlistId, track.trackhash))
        .setUri(StreamUrls.build(base, track.trackhash, track.filepath))
        .setCustomCacheKey(track.trackhash)
        .setMediaMetadata(metadataOf(track).setIsBrowsable(false).setIsPlayable(true).build())
        .build()

    private fun metadataOf(track: TrackInfo): MediaMetadata.Builder = MediaMetadata.Builder()
        .setTitle(track.title)
        .setArtist(track.artists.joinToString(", "))
        .setAlbumTitle(track.album)
        .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    // TODO(#747): setArtworkUri once covers can be fetched without the bearer header.

    // endregion

    // region Scrobbling

    /**
     * Adds up the time each track really plays and sends it when the track changes, the queue
     * ends, or the service is destroyed. Only the player's thread touches it.
     */
    private inner class Scrobbler : Player.Listener {

        private val timer = ListeningTimer()

        /** The track being timed, identified from its media id. */
        private var current: MediaRef.Track? = null

        override fun onIsPlayingChanged(isPlaying: Boolean) {
            val now = SystemClock.elapsedRealtime()
            if (isPlaying) timer.onPlaying(now) else timer.onNotPlaying(now)
        }

        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            flush()
            current = MediaIds.parse(mediaItem?.mediaId) as? MediaRef.Track
            if (player.isPlaying) timer.onPlaying(SystemClock.elapsedRealtime())
        }

        override fun onPlaybackStateChanged(playbackState: Int) {
            if (playbackState == Player.STATE_ENDED) flush()
        }

        /** Sends the listened time of the current track, if it reaches the minimum. Never blocks. */
        fun flush() {
            // Read and reset first, even without a track: time timed while no track was set
            // must not be credited to the next one.
            val listened = timer.listenedMs(SystemClock.elapsedRealtime())
            timer.reset()
            if (player.isPlaying) timer.onPlaying(SystemClock.elapsedRealtime())
            val track = current ?: return

            val seconds = ScrobbleRules.seconds(listened)
            if (!ScrobbleRules.shouldSend(seconds)) return

            val play = ScrobblePlay(
                trackhash = track.trackhash,
                timestamp = System.currentTimeMillis() / 1000L,
                duration = seconds,
                source = "pl:${track.playlistId}",
            )
            scrobbleScope.launch {
                // Any exception: an uncaught one here would kill the service mid-drive. A lost play
                // is the lesser harm; buffering plays for dead spots comes with offline (#747).
                try {
                    api.logPlay(play)
                } catch (e: Exception) {
                    Log.w(TAG, "Scrobble failed", e)
                }
            }
        }
    }

    // endregion

    companion object {
        private const val TAG = "PlaybackService"
    }
}
