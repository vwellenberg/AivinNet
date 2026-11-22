package net.aivinnet.auto

import android.content.ContentProvider
import android.content.ContentResolver
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.ParcelFileDescriptor
import java.io.FileNotFoundException
import java.io.IOException
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Semaphore

/**
 * Serves the covers of tracks and of playlists with their own image as JPEG files for Android Auto's
 * artwork. Read-only. The URIs are built by [uri] and checked by [CoverSpec.parse]; the file behind a
 * URI is always one of [CoverCache]'s, never a path taken from the URI.
 *
 * Android Auto cannot send the login, so the app fetches the cover itself, with the signed-in client
 * (see [AivinApi.imageBytes]), and the token never leaves the app. The car waits on [openFile], hence
 * the hard deadline: a cover that does not come in time is the car's placeholder, not a stuck screen.
 */
class CoverProvider : ContentProvider() {

    private val api: AivinApi by lazy { AivinApi.create(requireNotNull(context)) }

    override fun onCreate(): Boolean = true

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw FileNotFoundException("Covers are read only")
        val cover = coverOf(uri) ?: throw FileNotFoundException("No cover at $uri")
        val file = runBlocking { cachedOrFetched(cover) } ?: throw FileNotFoundException("No cover for $uri")
        return try {
            ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY)
        } catch (e: IOException) {
            // Pruned between the check and the open: the car gets the placeholder, as for any missing cover.
            throw FileNotFoundException("Cover gone: $uri")
        }
    }

    override fun getType(uri: Uri): String? = coverOf(uri)?.let { "image/jpeg" }

    override fun query(uri: Uri, projection: Array<String>?, selection: String?, selectionArgs: Array<String>?, sortOrder: String?): Cursor? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri = throw UnsupportedOperationException("Covers are read only")

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<String>?): Int = 0

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<String>?): Int = 0

    /**
     * The car calls [openFile] on the app's binder threads, the same few that carry its browse and
     * transport calls. A cached cover is served at once. A fetch holds a thread for up to
     * [DEADLINE_MS], so at most [PARALLEL_FETCHES] run; any further request gets the placeholder now
     * and the cover on a later browse, instead of queueing behind the others. After a failure to reach
     * the server the cache answers alone for a minute (see [CoverCache]).
     */
    private suspend fun cachedOrFetched(cover: CoverSpec.Cover): java.io.File? {
        val context = requireNotNull(context)
        if (!fetches.tryAcquire()) {
            // No permit: only what is already on disk.
            return CoverCache.cached(context, cover)
        }
        return try {
            CoverCache.ensure(context, api, cover, DEADLINE_MS, fetchWhenUnreachable = false).file
        } finally {
            fetches.release()
        }
    }

    private val fetches = Semaphore(PARALLEL_FETCHES)

    private fun coverOf(uri: Uri): CoverSpec.Cover? =
        CoverSpec.parse(uri.pathSegments, uri.getQueryParameter(CoverSpec.PARAM_PATHHASH))

    companion object {
        /**
         * The total time one cover may take, the car's own wait on the artwork included. Read as "the car
         * waits on this call", so it is deliberately short; a cover that misses it is fetched by the next
         * browse or by the offline sync.
         */
        private const val DEADLINE_MS = 4_000L

        /** Cover fetches at once; the rest are answered from the cache (see [cachedOrFetched]). */
        private const val PARALLEL_FETCHES = 4

        /** The authority, derived from the package like the manifest's `${applicationId}.covers`. */
        fun authority(packageName: String): String = "$packageName.covers"

        /** The URI of [cover]. The pathhash rides along as a query parameter for a track. */
        fun uri(packageName: String, cover: CoverSpec.Cover): Uri {
            val builder = Uri.Builder()
                .scheme(ContentResolver.SCHEME_CONTENT)
                .authority(authority(packageName))
                .appendPath("cover")
                .appendPath(cover.kind.wire)
                .appendPath(cover.image)
            cover.pathhash?.let { builder.appendQueryParameter(CoverSpec.PARAM_PATHHASH, it) }
            return builder.build()
        }
    }
}
