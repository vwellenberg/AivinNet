package net.aivinnet.auto

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams

/**
 * What the car shows around an item besides its title: the heading of its group, its artwork and its
 * download badge. Android Auto draws the screen itself, so these are the only things it can be told.
 */
data class ItemStyle(
    val heading: BrowseGroups.Heading? = null,
    val artwork: Uri? = null,
    val downloaded: Boolean = false,
) {
    companion object {
        val NONE = ItemStyle()
    }
}

/**
 * Builds the items of the browse tree: tabs, playlists and tracks, with their styles. The playback
 * side (stream URIs) is [playable].
 *
 * Artwork and headings are hints. Android Auto may ignore them, so an item must list and play the
 * same without them.
 */
class BrowseItems(private val context: Context) {

    /** The root folder. The car reads its children as tabs. */
    fun root(): MediaItem = folder(MediaIds.ROOT, context.getString(R.string.app_name), artwork = null)

    /** A root tab: a browsable folder with the monochrome icon [icon] (a drawable name). */
    fun tab(id: String, title: String, icon: String): MediaItem = folder(id, title, drawable(icon))

    /**
     * The default styles of the root's children: browsable items as a grid, playable ones as a list.
     * Set on the root result, so the car lays out every folder without asking for the style itself.
     */
    fun rootParams(): LibraryParams = LibraryParams.Builder()
        .setExtras(
            Bundle().apply {
                putInt(
                    MediaConstants.EXTRAS_KEY_CONTENT_STYLE_BROWSABLE,
                    MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_GRID_ITEM,
                )
                putInt(
                    MediaConstants.EXTRAS_KEY_CONTENT_STYLE_PLAYABLE,
                    MediaConstants.EXTRAS_VALUE_CONTENT_STYLE_LIST_ITEM,
                )
            },
        )
        .build()

    /** The text of a group heading, from the German resources. */
    fun heading(heading: BrowseGroups.Heading): String = context.getString(
        when (heading) {
            BrowseGroups.Heading.PINNED -> R.string.group_pinned
            BrowseGroups.Heading.ALL_PLAYLISTS -> R.string.group_all_playlists
            BrowseGroups.Heading.FOR_YOU -> R.string.group_for_you
            BrowseGroups.Heading.MIXES -> R.string.group_mixes
            BrowseGroups.Heading.STATIONS -> R.string.group_stations
        },
    )

    /** A generated playlist (mix, home row or station) as the server returned it. */
    fun generated(detail: PlaylistDetail, heading: BrowseGroups.Heading?): MediaItem =
        playlist(detail.id, detail.name, detail.tracks.size, ItemStyle(heading = heading))

    /** A playlist (`pl:`) or, with [offline], an offline playlist (`off:`) of the browse tree. */
    fun playlist(
        id: String,
        name: String,
        count: Int,
        style: ItemStyle = ItemStyle.NONE,
        offline: Boolean = false,
    ): MediaItem = MediaItem.Builder()
        .setMediaId(if (offline) MediaIds.offlinePlaylist(id) else MediaIds.playlist(id))
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(name)
                .setSubtitle(context.resources.getQuantityString(R.plurals.track_count, count, count))
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                .styled(style)
                .build(),
        )
        .build()

    /** Browse entry of a track: no URI yet. The URI is added when the track is chosen. */
    fun track(playlistId: String, track: TrackInfo, style: ItemStyle = ItemStyle.NONE): MediaItem = MediaItem.Builder()
        .setMediaId(MediaIds.track(playlistId, track.trackhash))
        .setMediaMetadata(metadataOf(track).setIsBrowsable(false).setIsPlayable(true).styled(style).build())
        .build()

    /**
     * The cache key is the trackhash, so a download made under another filepath (or another server
     * address) is still found. Downloads use the same key, see [OfflineEngine.request].
     */
    fun playable(playlistId: String, track: TrackInfo, base: String): MediaItem = MediaItem.Builder()
        .setMediaId(MediaIds.track(playlistId, track.trackhash))
        .setUri(StreamUrls.build(base, track.trackhash, track.filepath))
        .setCustomCacheKey(track.trackhash)
        .setMediaMetadata(metadataOf(track).setIsBrowsable(false).setIsPlayable(true).build())
        .build()

    private fun folder(id: String, title: String, artwork: Uri?): MediaItem = MediaItem.Builder()
        .setMediaId(id)
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(title)
                .setArtworkUri(artwork)
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_FOLDER_MIXED)
                .build(),
        )
        .build()

    private fun metadataOf(track: TrackInfo): MediaMetadata.Builder = MediaMetadata.Builder()
        .setTitle(track.title)
        .setArtist(track.artists.joinToString(", "))
        .setAlbumTitle(track.album)
        .setMediaType(MediaMetadata.MEDIA_TYPE_MUSIC)
    // TODO(#747): setArtworkUri for tracks once covers can be fetched without the bearer header.

    /** Applies the artwork, the group heading and the download badge; each is set only when present. */
    private fun MediaMetadata.Builder.styled(style: ItemStyle): MediaMetadata.Builder = apply {
        style.artwork?.let { setArtworkUri(it) }
        val extras = Bundle()
        style.heading?.let { extras.putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, heading(it)) }
        if (style.downloaded) {
            // A long in Media3, unlike the content-style values, which are ints.
            extras.putLong(MediaConstants.EXTRAS_KEY_DOWNLOAD_STATUS, MediaConstants.EXTRAS_VALUE_STATUS_DOWNLOADED)
        }
        if (!extras.isEmpty) setExtras(extras)
    }

    /** `android.resource://<package>/drawable/<name>`, the URI Android Auto loads a vector from. */
    private fun drawable(name: String): Uri = Uri.Builder()
        .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
        .authority(context.packageName)
        .appendPath("drawable")
        .appendPath(name)
        .build()
}
