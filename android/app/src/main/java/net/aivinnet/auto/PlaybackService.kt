package net.aivinnet.auto

import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.cache.CacheDataSource
import androidx.media3.datasource.okhttp.OkHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaLibraryService.LibraryParams
import androidx.media3.session.MediaLibraryService.MediaLibrarySession
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionCommand
import androidx.media3.session.SessionCommands
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import com.google.common.collect.ImmutableList
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.cancel
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext

/**
 * The media service Android Auto browses and plays from. The phone UI is only the login screen.
 *
 * Browse tree: root (the tabs) → "home" / "mixes" (with stations) / "playlists" → playlist (`pl:<id>`)
 * → track (`tr:<id>:<hash>`). root → "offline" → offline playlist (`off:<id>`) → track: from the
 * snapshots, no network needed. Items are built in [BrowseItems]; this class answers the calls.
 * A chosen track sets the whole playlist as the queue, so next and previous work. Without network,
 * a playlist resolves to its offline copy, which keeps only the downloaded tracks.
 *
 * Media3's session and library APIs are all marked @UnstableApi. Media3 documents them as the
 * supported surface for media apps, so the marker goes on the class.
 */
@UnstableApi
class PlaybackService : MediaLibraryService() {

    private lateinit var api: AivinApi
    private lateinit var offline: OfflineEngine
    private lateinit var player: ExoPlayer
    private lateinit var session: MediaLibrarySession
    private lateinit var browse: BrowseItems

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

    /** Browse folders answered from the offline copies; they are asked again once the server answers. */
    private val freshness = BrowseFreshness()

    /** One probe at a time: the network callbacks and the retry loop can both ask for one. */
    private val refreshMutex = Mutex()

    /** The loop that probes every [RETRY_INTERVAL_MS] while a folder is stale; null when none runs. Guarded by [retryLock]. */
    private val retryLock = Any()
    private var retryJob: Job? = null

    private lateinit var connectivity: ConnectivityManager

    /** Set first in onDestroy; posted notifications check it, since the session is released then. */
    @Volatile private var destroyed = false
    private val mainHandler = Handler(Looper.getMainLooper())

    /**
     * Listens for the network coming back. The system calls these on its own thread, so they only
     * schedule work. They also fire once at registration, for the network that is up then.
     */
    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) = probeIfStale()

        /**
         * The network can be "available" before the server is reachable (VPN, DS-Lite), so only a
         * validated one counts. This also fires on every signal change, so the queues are sent once
         * per network that becomes validated, not on each call.
         */
        override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
            if (!capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)) return
            if (validatedNetwork != network) {
                validatedNetwork = network
                // Plays and ratings from the dead spot go out now, whether or not a list was shown offline.
                scrobbleScope.launch {
                    offline.flushScrobbles(api)
                    offline.flushRatings(api)
                }
            }
            probeIfStale()
        }

        /** Network gone: the car asks for the two lists again and gets their offline copies. */
        override fun onLost(network: Network) {
            if (validatedNetwork == network) validatedNetwork = null
            notifyBrowseChanged(listOf(MediaIds.HOME, MediaIds.MIXES, MediaIds.PLAYLISTS))
        }
    }

    /** The network the queues were last sent on. Set in onCreate, then only by the network callback. */
    @Volatile private var validatedNetwork: Network? = null

    /**
     * The rating button acts on the playing track. [ratedTrack] is its trackhash, [shownRating] the
     * rating the button shows. Only the main thread touches these. [ratingEpoch] changes with every
     * track change and press, so a slow lookup for an older state cannot overwrite a newer one.
     */
    private var ratedTrack: String? = null
    private var shownRating: Int? = null
    /** False until the lookup for [ratedTrack] has answered: a press then asks first instead of guessing. */
    private var ratingKnown = false
    private var ratingEpoch = 0
    /** The lookup for the playing track; a newer track change cancels it instead of letting it run on. */
    private var ratingLookup: Job? = null

    override fun onCreate() {
        super.onCreate()
        api = AivinApi.create(this)
        browse = BrowseItems(this)
        offline = OfflineEngine.get(this)
        browseScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

        // Plays and ratings that failed without network (a dead spot) are sent now, before anything else.
        scrobbleScope.launch {
            offline.flushScrobbles(api)
            offline.flushRatings(api)
        }

        // Downloaded tracks play from disk, the rest streams. The cache is read-only here, and that is
        // deliberate: it never evicts, so a stream written into it would grow with every track played.
        // Only the download service writes it. Streams keep the bearer and refresh logic of the API calls.
        val cacheFactory = CacheDataSource.Factory()
            .setCache(offline.cache)
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
        player.addListener(RatingTracker())

        session = MediaLibrarySession.Builder(this, player, LibraryCallback()).build()

        // Last: the callback can fire at once, and it uses the session.
        connectivity = getSystemService(ConnectivityManager::class.java)
        // The network that is up now already got its flush above; registering reports it at once.
        validatedNetwork = connectivity.activeNetwork
        connectivity.registerDefaultNetworkCallback(networkCallback)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession = session

    /** Stop the service when the app is swiped away and nothing is playing. Media3 standard. */
    override fun onTaskRemoved(rootIntent: Intent?) {
        if (!player.playWhenReady || player.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        destroyed = true
        scrobbler.flush()
        // Before the session goes: a callback after release would notify a dead session.
        connectivity.unregisterNetworkCallback(networkCallback)
        mainHandler.removeCallbacksAndMessages(null)
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
            val sessionCommands = if (mayBrowse(controller)) {
                MediaSession.ConnectionResult.DEFAULT_SESSION_AND_LIBRARY_COMMANDS
                    .buildUpon()
                    .add(RATING_COMMAND)
                    .build()
            } else {
                Log.i(TAG, "Player-only connection for ${controller.packageName}")
                SessionCommands.EMPTY
            }
            return MediaSession.ConnectionResult.AcceptedResultBuilder(session)
                .setAvailableSessionCommands(sessionCommands)
                .setAvailablePlayerCommands(MediaSession.ConnectionResult.DEFAULT_PLAYER_COMMANDS)
                .build()
        }

        /** Shows the rating button to a controller that may browse; the player-only ones never see it. */
        override fun onPostConnect(session: MediaSession, controller: MediaSession.ControllerInfo) {
            if (mayBrowse(controller)) {
                session.setMediaButtonPreferences(controller, ratingLayout())
            }
        }

        /**
         * The rating button's press. It toggles the rating of the track that is playing (see
         * [RatingRules]), shows the result at once, and sends it, or queues it when the server
         * cannot be reached. The future resolves after the send attempt; the car never waits on it.
         */
        override fun onCustomCommand(
            session: MediaSession,
            controller: MediaSession.ControllerInfo,
            customCommand: SessionCommand,
            args: Bundle,
        ): ListenableFuture<SessionResult> {
            if (customCommand.customAction != ACTION_TOGGLE_RATING || !mayBrowse(controller)) {
                return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_NOT_SUPPORTED))
            }
            val trackhash = ratedTrack
                ?: return Futures.immediateFuture(SessionResult(SessionResult.RESULT_ERROR_BAD_VALUE))

            val known = ratingKnown
            val shown = shownRating
            val epoch = ++ratingEpoch
            ratingLookup?.cancel()
            if (known) showRating(trackhash, RatingRules.toggle(shown), epoch)

            // scrobbleScope, not browseScope: a press must still reach the server when the car stops
            // playback and the service goes away, as a play does.
            return scrobbleScope.future {
                // Pressed before the lookup answered: ask first. Toggling from "unknown" set 5 on a
                // track already rated 5, so the first press did nothing visible.
                val next = if (known) RatingRules.toggle(shown) else RatingRules.toggle(loadRating(trackhash))
                if (!known) withContext(Dispatchers.Main) { showRating(trackhash, next, epoch) }

                val result = offline.recordRating(api, trackhash, next)
                // Refused for good (e.g. 404, the track is gone on the server): show what the server holds.
                if (result != null && trackhash in result.rejectedTracks) {
                    val actual = loadRating(trackhash)
                    withContext(Dispatchers.Main) { showRating(trackhash, actual, epoch) }
                }
                SessionResult(SessionResult.RESULT_SUCCESS)
            }
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
                // The root's params carry the default content styles (grid tabs, list items).
                LibraryResult.ofItem(browse.root(), browse.rootParams())
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
                var detail = playlistOrOffline(single.playlistId, fresh = false).detail
                if (detail?.tracks?.none { it.trackhash == single.trackhash } != false) {
                    detail = playlistOrOffline(single.playlistId, fresh = true).detail
                }
                detail ?: throw AivinException("Playlist nicht gefunden")
                val start = detail.tracks.indexOfFirst { it.trackhash == single.trackhash }
                if (start < 0) throw AivinException("Titel nicht in der Playlist")
                val queue = detail.tracks.map { browse.playable(detail.id, it, base) }
                MediaSession.MediaItemsWithStartPosition(queue, start, C.TIME_UNSET)
            } else {
                val resolved = resolve(mediaItems)
                val index = if (resolved.isEmpty()) 0 else startIndex.coerceIn(0, resolved.lastIndex)
                MediaSession.MediaItemsWithStartPosition(resolved, index, startPositionMs)
            }
        }
    }

    /**
     * The items of a browse folder. The offline state (snapshots and downloaded tracks) is read once per
     * folder answer, never per item, so the badges cost one read.
     */
    private suspend fun children(parentId: String): List<MediaItem> = when (val ref = MediaIds.parse(parentId)) {
        MediaRef.Root -> listOf(
            browse.tab(MediaIds.HOME, getString(R.string.browse_home), R.drawable.ic_tab_home),
            browse.tab(MediaIds.MIXES, getString(R.string.browse_mixes), R.drawable.ic_tab_mixes),
            browse.tab(MediaIds.PLAYLISTS, getString(R.string.browse_playlists), R.drawable.ic_tab_playlists),
            browse.tab(MediaIds.OFFLINE, getString(R.string.browse_offline), R.drawable.ic_tab_offline),
        )
        MediaRef.Home -> homeFolder(parentId)
        MediaRef.Mixes -> mixesFolder(parentId)
        MediaRef.Playlists -> playlistsFolder(parentId)
        is MediaRef.Playlist -> playlistTracks(parentId, ref.id)
        // The offline folder reads only the snapshots and the download index: it works without any network.
        MediaRef.Offline -> offlineListing(offlineBadges()) { true }
        // Every track of an offline copy is on disk, so each one is badged.
        is MediaRef.OfflinePlaylist -> offlineCopy(ref.id)?.tracks
            ?.map { browse.track(ref.id, it, ItemStyle(downloaded = true)) }
            ?: emptyList()
        else -> emptyList()
    }

    /**
     * Home: the generated rows the user has. No network: the offline copies of them. If there are none,
     * the error stands.
     */
    private suspend fun homeFolder(parentId: String): List<MediaItem> {
        val badges = offlineBadges()
        return try {
            fetchGenerated(MediaIds.HOME_IDS)
                .map { detail ->
                    browse.generated(detail, ItemStyle(BrowseGroups.Heading.FOR_YOU, downloaded = badges.playlistComplete(detail.id)))
                }
                .also { answered(parentId, offline = false) }
        } catch (e: IOException) {
            answeredWithout(parentId, e)
            offlineListing(badges) { it in MediaIds.HOME_IDS }.ifEmpty { throw e }
        }
    }

    /**
     * Mixes, then the stations, in one parallel batch. Each group has its heading; a 404 or an empty
     * playlist is skipped. No network: the offline copies of both.
     */
    private suspend fun mixesFolder(parentId: String): List<MediaItem> {
        val badges = offlineBadges()
        return try {
            fetchGenerated(MediaIds.MIX_IDS + MediaIds.STATION_IDS)
                .map { detail ->
                    val heading = if (detail.id in MediaIds.MIX_IDS) BrowseGroups.Heading.MIXES else BrowseGroups.Heading.STATIONS
                    browse.generated(detail, ItemStyle(heading, downloaded = badges.playlistComplete(detail.id)))
                }
                .also { answered(parentId, offline = false) }
        } catch (e: IOException) {
            answeredWithout(parentId, e)
            offlineListing(badges) { it in MediaIds.MIX_IDS || it in MediaIds.STATION_IDS }.ifEmpty { throw e }
        }
    }

    /**
     * The playlists of the server, pinned first under their heading (see [BrowseGroups]). No network: the
     * offline copies of the user's own playlists.
     */
    private suspend fun playlistsFolder(parentId: String): List<MediaItem> {
        val badges = offlineBadges()
        return try {
            BrowseGroups.playlists(api.playlists()) { it.pinned }
                .flatMap { group ->
                    group.items.map {
                        browse.playlist(it.id, it.name, it.count, ItemStyle(group.heading, downloaded = badges.playlistComplete(it.id)))
                    }
                }
                .also { answered(parentId, offline = false) }
        } catch (e: IOException) {
            answeredWithout(parentId, e)
            offlineListing(badges) { !MediaIds.isGenerated(it) }.ifEmpty { throw e }
        }
    }

    /** The tracks of one playlist, from the server or, without network, its offline copy. */
    private suspend fun playlistTracks(parentId: String, id: String): List<MediaItem> {
        // Opening a playlist always shows its current state; the tap then reuses this fetch.
        val answer = try {
            playlistOrOffline(id, fresh = true)
        } catch (e: IOException) {
            answeredWithout(parentId, e)
            throw e
        }
        if (answer.fromOffline) answeredWithout(parentId, null) else answered(parentId, offline = false)
        val detail = answer.detail ?: return emptyList()
        val completed = offline.completedTrackhashes()
        return detail.tracks.map { browse.track(detail.id, it, ItemStyle(downloaded = it.trackhash in completed)) }
    }

    /** The snapshots and the downloaded tracks, read once for one folder answer. */
    private fun offlineBadges(): OfflineBrowse.Badges =
        OfflineBrowse.Badges(offlineSnapshots(), offline.completedTrackhashes())

    /**
     * The generated playlists [ids] the user has, fetched in parallel and kept in the order of [ids].
     * A 404 or an empty playlist is skipped. A network failure fails the whole list, so the caller
     * falls back to the offline copies.
     */
    private suspend fun fetchGenerated(ids: List<String>): List<PlaylistDetail> = coroutineScope {
        ids.map { id -> async { playlist(id, fresh = true) } }
            .awaitAll()
            .filterNotNull()
            .filter { it.tracks.isNotEmpty() }
    }

    /** A playlist from the cache, or fetched (and cached) when [fresh] or not cached. */
    private suspend fun playlist(id: String, fresh: Boolean = false): PlaylistDetail? {
        if (!fresh) playlists.get(id)?.let { return it.detail }
        return api.playlist(id).also { playlists.put(id, it) }
    }

    /** A playlist answer, and whether it came from the offline copy instead of the server. */
    private class PlaylistAnswer(val detail: PlaylistDetail?, val fromOffline: Boolean)

    /**
     * The playlist from the server, or with no network its offline copy. The copy keeps only the
     * downloaded tracks, the only ones that can play in a dead spot. Without a copy the network
     * error is rethrown.
     */
    private suspend fun playlistOrOffline(id: String, fresh: Boolean): PlaylistAnswer = try {
        PlaylistAnswer(playlist(id, fresh), fromOffline = false)
    } catch (e: IOException) {
        PlaylistAnswer(offlineCopy(id) ?: throw e, fromOffline = true)
    }

    /**
     * The server could not answer [parentId]: the car got the offline copy or, without one, the error.
     * Either way it must ask again once the server is back, or the error stays for the whole drive.
     * A refusal (a 4xx such as a deleted playlist, or an expired login) does not count: the server
     * would answer the same again, and while it answers the probe, the car would be told to reload
     * every 30 s. A 5xx counts, since that clears up on the server's side.
     */
    private fun answeredWithout(parentId: String, failure: IOException?) {
        if (BrowseFreshness.retries(failure)) answered(parentId, offline = true)
    }

    /** Records how a browse folder was answered, so the car is told to ask again once the server is back. */
    private fun answered(parentId: String, offline: Boolean) {
        if (offline) {
            freshness.markOffline(parentId)
            startRetryLoop()
        } else {
            freshness.markOnline(parentId)
        }
    }

    /** The snapshot of an offline playlist reduced to its downloaded tracks; null when it is not offline. */
    private fun offlineCopy(id: String): PlaylistDetail? {
        val snapshot = offlineSnapshots()[id] ?: return null
        return OfflineBrowse.playable(snapshot, offline.completedTrackhashes())
    }

    /** The snapshots of this account's offline playlists; empty when nobody is signed in. */
    private fun offlineSnapshots(): Map<String, PlaylistDetail?> {
        val account = api.store.accountKey ?: return emptyMap()
        return offline.store.load().snapshots(account)
    }

    /**
     * The offline playlists that [include] selects and that have something to play, as `off:` items.
     * Badged when the whole copy is on disk, which the listing alone does not show: it keeps only the
     * downloaded tracks.
     */
    private fun offlineListing(badges: OfflineBrowse.Badges, include: (String) -> Boolean): List<MediaItem> =
        OfflineBrowse.listed(badges.snapshots, badges.completed, include).map {
            browse.playlist(
                it.id,
                it.name,
                it.tracks.size,
                ItemStyle(downloaded = badges.playlistComplete(it.id)),
                offline = true,
            )
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
                playlistOrOffline(ref.playlistId, fresh = false).detail.also { details[ref.playlistId] = it }
            }
            val track = detail?.tracks?.firstOrNull { it.trackhash == ref.trackhash } ?: continue
            out += browse.playable(ref.playlistId, track, base)
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

    // endregion

    // region Browse freshness

    /**
     * Keeps probing the server while a folder is stale, so the car gets the live lists even when the
     * network is "up" but the server is not reachable yet. One loop at a time; it ends when nothing is stale.
     */
    private fun startRetryLoop() {
        synchronized(retryLock) {
            if (retryJob != null) return
            retryJob = browseScope.launch {
                while (true) {
                    delay(RETRY_INTERVAL_MS)
                    refreshBrowse()
                    // The end is decided under the lock: a folder marked stale right now either sees
                    // this loop still running, or finds retryJob cleared and starts a new one.
                    synchronized(retryLock) {
                        if (!freshness.hasStale()) {
                            retryJob = null
                            return@launch
                        }
                    }
                }
            }
        }
    }

    /** A network event: probe at once, if anything is stale. */
    private fun probeIfStale() {
        if (!freshness.hasStale()) return
        browseScope.launch { refreshBrowse() }
    }

    /**
     * Probes the server and, when it answers, tells the car to ask again for the stale folders and sends
     * what was queued offline. A failed probe leaves the folders stale for the retry loop.
     */
    private suspend fun refreshBrowse() {
        // A probe already running answers for this one too. Capability changes arrive every few
        // seconds on mobile data, and queued probes would otherwise run back to back.
        if (!refreshMutex.tryLock()) return
        try {
            if (!freshness.hasStale()) return
            // Sockets opened on the previous network would hang the probe until its timeout.
            api.resetConnections()
            try {
                api.playlists()
            } catch (e: CancellationException) {
                throw e
            } catch (e: AuthExpiredException) {
                // Signed out or the login was refused: no list comes back by retrying. The car
                // already shows "sign in on the phone" on its next browse.
                freshness.takeStale()
                return
            } catch (e: Exception) {
                Log.i(TAG, "Server still unreachable", e)
                return
            }
            notifyBrowseChanged(freshness.takeStale())
            // The server answers again: what was queued in the dead spot goes now (a VPN can come
            // back without a new validated network, so the network callback alone would miss it).
            scrobbleScope.launch {
                offline.flushScrobbles(api)
                offline.flushRatings(api)
            }
        } finally {
            refreshMutex.unlock()
        }
    }

    /**
     * Tells the car that these folders changed, so it browses them again. Posted to the main thread,
     * where the session is used.
     */
    private fun notifyBrowseChanged(parentIds: List<String>) {
        if (parentIds.isEmpty()) return
        mainHandler.post {
            // A probe still in its HTTP call when the service stops posts after onDestroy.
            if (destroyed) return@post
            for (id in parentIds) session.notifyChildrenChanged(id, Int.MAX_VALUE, null)
        }
    }

    // endregion

    // region Rating button

    /** Whether a controller may browse the library (and so sees the rating button). */
    private fun mayBrowse(controller: MediaSession.ControllerInfo): Boolean = ControllerTrust.mayBrowse(
        packageName = controller.packageName,
        packageVerified = controller.isPackageNameVerified,
        systemTrusted = controller.isTrusted,
        ownPackage = packageName,
    )

    /**
     * Resets the button for each new track and looks up its rating. The lookup prefers a rating still
     * waiting in the queue (that is what the user last did), then the server; offline without a queued
     * change the state stays unknown and a press sets 5.
     */
    private inner class RatingTracker : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            val trackhash = (MediaIds.parse(mediaItem?.mediaId) as? MediaRef.Track)?.trackhash
            ratedTrack = trackhash
            shownRating = null
            ratingKnown = false
            val epoch = ++ratingEpoch
            ratingLookup?.cancel()
            showRatingButton()
            if (trackhash == null) return

            ratingLookup = browseScope.launch {
                val rating = loadRating(trackhash)
                withContext(Dispatchers.Main) { showRating(trackhash, rating, epoch) }
            }
        }
    }

    /** Shows [rating] for [trackhash], unless the track or a newer press has moved on. Main thread only. */
    private fun showRating(trackhash: String, rating: Int?, epoch: Int) {
        if (ratedTrack != trackhash || ratingEpoch != epoch) return
        shownRating = rating
        ratingKnown = true
        showRatingButton()
    }

    private suspend fun loadRating(trackhash: String): Int? {
        val owner = api.store.accountKey
        if (owner != null) offline.ratings.pending(owner, trackhash)?.let { return it.rating }
        return try {
            api.ratingOf(trackhash)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Any failure, not only IOException: this runs in a launch without a handler, and an
            // uncaught exception there would end the service, and the music in the car with it.
            Log.i(TAG, "Rating of the playing track unknown", e)
            null
        }
    }

    /** Pushes the button to every controller that may browse. Main thread only. */
    private fun showRatingButton() {
        val layout = ratingLayout()
        for (controller in session.connectedControllers) {
            if (mayBrowse(controller)) session.setMediaButtonPreferences(controller, layout)
        }
    }

    /** One button: a filled star when the track is rated 5, an outline star otherwise. */
    private fun ratingLayout(): ImmutableList<CommandButton> {
        val rated = shownRating == RatingRules.FULL_MARK
        val button = CommandButton.Builder(
            if (rated) CommandButton.ICON_STAR_FILLED else CommandButton.ICON_STAR_UNFILLED,
        )
            .setDisplayName(getString(if (rated) R.string.rating_rated else R.string.rating_rate))
            .setSessionCommand(RATING_COMMAND)
            // Next to the transport buttons where there is room, in the overflow otherwise.
            .setSlots(CommandButton.SLOT_FORWARD_SECONDARY, CommandButton.SLOT_OVERFLOW)
            .setEnabled(ratedTrack != null)
            .build()
        return ImmutableList.of(button)
    }

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
            // A play the server cannot take now waits in the outbox (dead spots), and any error is
            // contained there: an uncaught one in this scope would kill the service mid-drive.
            scrobbleScope.launch { offline.recordScrobble(api, play) }
        }
    }

    // endregion

    companion object {
        private const val TAG = "PlaybackService"

        /** How often a stale folder is probed while the server is unreachable. */
        private const val RETRY_INTERVAL_MS = 30_000L

        /** The custom command of the rating button. The action is what the car sends back on a press. */
        const val ACTION_TOGGLE_RATING = "net.aivinnet.auto.TOGGLE_RATING"
        private val RATING_COMMAND = SessionCommand(ACTION_TOGGLE_RATING, Bundle.EMPTY)
    }
}
