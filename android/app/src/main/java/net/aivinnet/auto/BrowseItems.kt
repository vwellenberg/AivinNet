package net.aivinnet.auto

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Bundle
import androidx.annotation.DrawableRes
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaLibraryService.LibraryParams

/**
 * What the car shows around an item besides its title: the heading of its group and its download
 * badge. Android Auto draws the screen itself, so these are the only things it can be told here; the
 * artwork is picked by [BrowseItems] from the kind of the item.
 */
data class ItemStyle(
    val heading: BrowseGroups.Heading? = null,
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
@UnstableApi
class BrowseItems(private val context: Context) {

    /** The root folder. The car reads its children as tabs. */
    fun root(): MediaItem = folder(MediaIds.ROOT, context.getString(R.string.app_name), artwork = null)

    /** A root tab: a browsable folder with the monochrome vector [icon]. */
    fun tab(id: String, title: String, @DrawableRes icon: Int): MediaItem = folder(id, title, drawable(icon))

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
    fun generated(detail: PlaylistDetail, style: ItemStyle): MediaItem =
        playlist(detail.id, detail.name, detail.tracks.size, style)

    /**
     * A playlist (`pl:`) or, with [offline], an offline playlist (`off:`) of the browse tree. [coverImage]
     * is the playlist's own cover from the server; without one, or offline, its tile is shown.
     */
    fun playlist(
        id: String,
        name: String,
        count: Int,
        style: ItemStyle = ItemStyle.NONE,
        offline: Boolean = false,
        coverImage: String? = null,
    ): MediaItem = MediaItem.Builder()
        .setMediaId(if (offline) MediaIds.offlinePlaylist(id) else MediaIds.playlist(id))
        .setMediaMetadata(
            MediaMetadata.Builder()
                .setTitle(name)
                .setSubtitle(context.resources.getQuantityString(R.plurals.track_count, count, count))
                .setArtworkUri(artworkFor(id, name, offline, coverImage))
                .setIsBrowsable(true)
                .setIsPlayable(false)
                .setMediaType(MediaMetadata.MEDIA_TYPE_PLAYLIST)
                .styled(style)
                .build(),
        )
        .build()

    /**
     * The picture of a playlist: its own cover when the server has one, otherwise a tile. A mix, a home
     * row or a station has its own tile, an offline copy the download glyph, and any other playlist its
     * letter. The name is cut to the longest one a tile URI takes.
     */
    private fun artworkFor(id: String, name: String, offline: Boolean, coverImage: String?): Uri {
        // Offline copies carry no image in their snapshot, so they keep the download tile.
        val own = if (offline) null else coverImage?.let { CoverSpec.ofPlaylist(it) }
        return own?.let { CoverProvider.uri(context.packageName, it) } ?: tileFor(id, name, offline)
    }

    private fun tileFor(id: String, name: String, offline: Boolean): Uri = when {
        offline -> TileProvider.uri(context.packageName, TileSpec.Kind.OFFLINE, id)
        id in MediaIds.MIX_IDS -> TileProvider.uri(context.packageName, TileSpec.Kind.MIX, id)
        id in MediaIds.HOME_IDS -> TileProvider.uri(context.packageName, TileSpec.Kind.ROW, id)
        id in MediaIds.STATION_IDS -> TileProvider.uri(context.packageName, TileSpec.Kind.STATION, id)
        else -> TileProvider.uri(
            context.packageName,
            TileSpec.Kind.PLAYLIST,
            id,
            name.take(TileSpec.MAX_NAME),
        )
    }

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
        .setArtworkUri(coverOf(track))

    /** The album cover of a track, served by [CoverProvider]; null when the track has no image. */
    private fun coverOf(track: TrackInfo): Uri? =
        CoverSpec.ofTrack(track.image)?.let { CoverProvider.uri(context.packageName, it) }

    /** Applies the group heading and the download badge; each is set only when present. */
    private fun MediaMetadata.Builder.styled(style: ItemStyle): MediaMetadata.Builder = apply {
        val extras = Bundle()
        style.heading?.let { extras.putString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE, heading(it)) }
        if (style.downloaded) {
            // A long in Media3, unlike the content-style values, which are ints.
            extras.putLong(MediaConstants.EXTRAS_KEY_DOWNLOAD_STATUS, MediaConstants.EXTRAS_VALUE_STATUS_DOWNLOADED)
        }
        if (!extras.isEmpty) setExtras(extras)
    }

    /**
     * `android.resource://<package>/drawable/<name>`, the URI Android Auto loads a vector from. The name
     * comes from the resource id, so a renamed icon cannot silently lose its picture.
     */
    private fun drawable(@DrawableRes id: Int): Uri = Uri.Builder()
        .scheme(ContentResolver.SCHEME_ANDROID_RESOURCE)
        .authority(context.packageName)
        .appendPath(context.resources.getResourceTypeName(id))
        .appendPath(context.resources.getResourceEntryName(id))
        .build()
}
