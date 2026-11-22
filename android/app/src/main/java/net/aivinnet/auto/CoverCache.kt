package net.aivinnet.auto

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The cover cache in `cacheDir/covers/`, shared by [CoverProvider] (the car's requests) and the offline
 * sync (the covers of the offline lists). Both go through [ensure], so a cover fetched by one is found
 * by the other under the same name ([CoverSpec.cacheName]).
 *
 * Covers are stored as JPEG at most [CoverSpec.MAX_SIDE] px on the long side, about 60 KB each. The
 * cache is pruned by last use, the way [TileProvider] prunes its tiles.
 */
object CoverCache {

    private const val DIR = "covers"

    /** A cached cover is one file; the prune starts above [MAX_CACHED] and stops at [KEEP_AFTER_PRUNE]. */
    const val MAX_CACHED = 1500
    const val KEEP_AFTER_PRUNE = 1000

    private const val JPEG_QUALITY = 85

    /** A cover above this size is not a cover; it is not read into memory. */
    private const val MAX_DOWNLOAD_BYTES = 8L * 1024 * 1024

    /**
     * The cached file of [cover], fetched and stored when it is not there yet. A cached cover is marked
     * as used, so the prune keeps the ones the car asks for. Null when no cover can be had: no login, a
     * placeholder, a network failure, a picture that does not decode, or the [deadlineMs] passing. The
     * caller decides what the car gets then; nothing here throws for a missing cover.
     *
     * Suspends and is cancellable: the fetch is cancelled with the coroutine, so a cancelled sync stops
     * at the cover it is on.
     */
    suspend fun ensure(context: Context, api: AivinApi, cover: CoverSpec.Cover, deadlineMs: Long): File? {
        val dir = File(context.cacheDir, DIR)
        val file = File(dir, CoverSpec.cacheName(cover))
        if (file.isFile) {
            file.setLastModified(System.currentTimeMillis())
            return file
        }
        return withTimeoutOrNull(deadlineMs) {
            try {
                val jpeg = decodeToJpeg(fetch(api, cover)) ?: return@withTimeoutOrNull null
                store(dir, file, jpeg)
                file
            } catch (e: IOException) {
                offlineLog("Cover ${cover.image} not available", e)
                null
            }
        }
    }

    /** The bytes of [cover] from the server, through the signed-in client. */
    private suspend fun fetch(api: AivinApi, cover: CoverSpec.Cover): ByteArray =
        api.imageBytes(CoverSpec.serverSegments(cover), cover.pathhash)

    /**
     * The picture as a JPEG scaled to [CoverSpec.MAX_SIDE], or null when [bytes] is not a picture. Drawn
     * on white, because a transparent PNG cover would otherwise turn black.
     */
    internal fun decodeToJpeg(bytes: ByteArray): ByteArray? {
        if (bytes.isEmpty() || bytes.size > MAX_DOWNLOAD_BYTES) return null
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null

        val (width, height) = CoverSpec.scaledSize(bounds.outWidth, bounds.outHeight)
        val decodeAt = BitmapFactory.Options().apply {
            inSampleSize = CoverSpec.sampleSize(bounds.outWidth, bounds.outHeight)
        }
        val source = BitmapFactory.decodeByteArray(bytes, 0, bytes.size, decodeAt) ?: return null
        val target = Bitmap.createBitmap(width, height, Bitmap.Config.RGB_565)
        try {
            Canvas(target).apply {
                drawColor(Color.WHITE)
                drawBitmap(source, null, Rect(0, 0, width, height), null)
            }
            return ByteArrayOutputStream().use { out ->
                if (!target.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)) null else out.toByteArray()
            }
        } finally {
            source.recycle()
            target.recycle()
        }
    }

    /** Written under a temporary name and renamed, so a half-written file is never served. */
    private fun store(dir: File, file: File, jpeg: ByteArray) {
        dir.mkdirs()
        val part = File.createTempFile(file.name, ".part", dir)
        try {
            part.writeBytes(jpeg)
            if (!part.renameTo(file)) throw IOException("Cover not stored")
        } finally {
            part.delete()
        }
        prune(dir)
    }

    /**
     * Keeps the cache bounded. The provider is exported, so any app on the phone can ask for covers of
     * made-up names; without a cap each would stay on disk. The least recently used go first.
     */
    @Synchronized
    private fun prune(dir: File) {
        val files = dir.listFiles { f -> f.isFile && f.name.endsWith(".jpg") } ?: return
        if (files.size <= MAX_CACHED) return
        files.sortedBy { it.lastModified() }.take(files.size - KEEP_AFTER_PRUNE).forEach { it.delete() }
    }
}
