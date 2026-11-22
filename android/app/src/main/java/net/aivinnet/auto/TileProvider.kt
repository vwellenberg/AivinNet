package net.aivinnet.auto

import android.content.ContentProvider
import android.content.ContentResolver
import android.content.ContentValues
import android.database.Cursor
import android.graphics.Bitmap
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.File
import java.io.FileNotFoundException
import java.io.FileOutputStream
import java.io.IOException

/**
 * Serves the Memphis tiles as PNG files for Android Auto's artwork. Read-only; the URIs are built by
 * [uri] and checked by [TileSpec.parse], so the only files that are ever opened are the tiles in the
 * app cache.
 *
 * A tile is rendered once and kept in `cacheDir/tiles/`. The car asks for the same tiles on each
 * browse, and the rendering is the only work done here.
 */
class TileProvider : ContentProvider() {

    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Tiles are read only")
        val tile = tileOf(uri) ?: throw FileNotFoundException("No tile at $uri")
        return ParcelFileDescriptor.open(cached(tile), ParcelFileDescriptor.MODE_READ_ONLY)
    }

    override fun getType(uri: Uri): String? = tileOf(uri)?.let { "image/png" }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Tiles are read only")

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

    private fun tileOf(uri: Uri): TileSpec.Tile? = TileSpec.parse(uri.pathSegments, uri.getQueryParameter(NAME_PARAM))

    /** The PNG of [tile], rendered on first use. Synchronized: two requests for one tile render it once. */
    @Synchronized
    private fun cached(tile: TileSpec.Tile): File {
        val dir = File(requireNotNull(context).cacheDir, DIR).apply { mkdirs() }
        val file = File(dir, TileSpec.cacheName(tile))
        if (file.isFile) {
            // Marks it as used, so the prune keeps the car's tiles and drops the ones nobody asks for.
            file.setLastModified(System.currentTimeMillis())
            return file
        }

        // Written under a temporary name and renamed, so a half-written PNG is never served.
        val bitmap = TileRenderer.render(tile)
        val part = File(dir, file.name + ".part")
        try {
            FileOutputStream(part).use { out ->
                if (!bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)) throw IOException("PNG not written")
            }
            if (!part.renameTo(file)) throw IOException("Tile not stored")
        } finally {
            bitmap.recycle()
            part.delete()
        }
        prune(dir)
        return file
    }

    /**
     * Keeps the cache bounded. The provider is exported (the car reads it from its own process), so
     * any app on the phone can ask for tiles of made-up playlist keys; without a cap each one would
     * stay on disk. The least recently used go first; a pruned tile is simply drawn again when asked for.
     */
    private fun prune(dir: File) {
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".png") } ?: return
        if (files.size <= MAX_CACHED) return
        files.sortedBy { it.lastModified() }.take(files.size - KEEP_AFTER_PRUNE).forEach { it.delete() }
    }

    companion object {
        /** The query parameter that carries a playlist's name, for its label. */
        const val NAME_PARAM = "name"

        private const val DIR = "tiles"

        /** About 5 KB per tile: a few MB at most. Real use (mixes, rows, stations, playlists) stays far below. */
        private const val MAX_CACHED = 600
        private const val KEEP_AFTER_PRUNE = 400

        /** The authority, derived from the package like the manifest's `${applicationId}.tiles`. */
        fun authority(packageName: String): String = "$packageName.tiles"

        /** The URI of a tile. [name] is only needed for a playlist's label. */
        fun uri(packageName: String, kind: TileSpec.Kind, key: String, name: String? = null): Uri {
            val builder = Uri.Builder()
                .scheme(ContentResolver.SCHEME_CONTENT)
                .authority(authority(packageName))
                .appendPath("tile")
                .appendPath(kind.wire)
                .appendPath(key)
            if (name != null) builder.appendQueryParameter(NAME_PARAM, name)
            return builder.build()
        }
    }
}
