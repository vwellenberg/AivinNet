package net.aivinnet.auto

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Rect
import android.os.SystemClock
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException
import kotlinx.coroutines.withTimeoutOrNull

/**
 * The cover cache in `cacheDir/covers/`, shared by [CoverProvider] (the car's requests) and the offline
 * sync (the covers of the offline lists). Both go through [ensure], so a cover fetched by one is found
 * by the other under the same name ([CoverSpec.cacheName]).
 *
 * Covers are stored as JPEG at most [CoverSpec.MAX_SIDE] px on the long side, about 60 KB each. The
 * cache is pruned by last use, the way [TileProvider] prunes its tiles.
 *
 * Two memories keep the single-threaded server from being asked the same thing over and over:
 * - a cover the server does not have (its placeholder, or 404) leaves a `.none` marker for
 *   [MISSING_TTL_MS], so scrolling past an album without art does not fetch it again each time;
 * - after a failure to reach the server, the car's requests are answered from the cache only for
 *   [UNREACHABLE_PAUSE_MS] (see [Outcome.FAILED] and `fetchWhenUnreachable`), instead of each one
 *   waiting out its deadline.
 */
object CoverCache {

    private const val DIR = "covers"
    private const val MISSING_SUFFIX = ".none"

    /** A cached cover is one file; the prune starts above [MAX_CACHED] and stops at [KEEP_AFTER_PRUNE]. */
    const val MAX_CACHED = 1500
    const val KEEP_AFTER_PRUNE = 1000

    private const val JPEG_QUALITY = 85

    /** How long "the server has no cover for this" holds before it is asked again (art can be added). */
    private const val MISSING_TTL_MS = 24L * 60 * 60 * 1000

    /** How long the car's requests skip the network after the server could not be reached. */
    private const val UNREACHABLE_PAUSE_MS = 60_000L

    /** [SystemClock.elapsedRealtime] until which the car's requests do not fetch. Internal for tests. */
    @Volatile
    internal var unreachableUntil = 0L

    enum class Outcome {
        /** The file is there (cached before or fetched now). */
        CACHED,

        /** The server has no cover for this (placeholder or 404), now or within [MISSING_TTL_MS]. */
        MISSING,

        /** The cover could not be had now: no login, network, deadline, a picture that does not decode. */
        FAILED,
    }

    data class Result(val file: File?, val outcome: Outcome)

    /**
     * The cached file of [cover], fetched and stored when it is not there yet. A cached cover is marked
     * as used, so the prune keeps the ones the car asks for. Nothing here throws for a missing cover;
     * the [Result] says what happened, and the caller decides what the car gets.
     *
     * With [fetchWhenUnreachable] false (the car's requests), a recent failure to reach the server
     * answers [Outcome.FAILED] at once instead of trying again.
     *
     * Suspends and is cancellable: the fetch is cancelled with the coroutine, so a cancelled sync stops
     * at the cover it is on.
     */
    suspend fun ensure(
        context: Context,
        api: AivinApi,
        cover: CoverSpec.Cover,
        deadlineMs: Long,
        fetchWhenUnreachable: Boolean,
    ): Result = ensure(context, cover, deadlineMs, fetchWhenUnreachable) { fetch(api, cover) }

    /** [ensure] with the fetch passed in, so the outcomes are testable without a server. */
    internal suspend fun ensure(
        context: Context,
        cover: CoverSpec.Cover,
        deadlineMs: Long,
        fetchWhenUnreachable: Boolean,
        fetchBytes: suspend () -> ByteArray,
    ): Result {
        val dir = File(context.cacheDir, DIR)
        val file = File(dir, CoverSpec.cacheName(cover))
        if (file.isFile) {
            file.setLastModified(System.currentTimeMillis())
            return Result(file, Outcome.CACHED)
        }
        val missing = File(dir, file.name + MISSING_SUFFIX)
        if (missing.isFile && System.currentTimeMillis() - missing.lastModified() < MISSING_TTL_MS) {
            return Result(null, Outcome.MISSING)
        }
        if (!fetchWhenUnreachable && SystemClock.elapsedRealtime() < unreachableUntil) {
            return Result(null, Outcome.FAILED)
        }
        return withTimeoutOrNull(deadlineMs) {
            try {
                val jpeg = decodeToJpeg(fetchBytes())
                    ?: return@withTimeoutOrNull Result(null, Outcome.FAILED)
                store(dir, file, jpeg)
                missing.delete()
                Result(file, Outcome.CACHED)
            } catch (e: CancellationException) {
                throw e
            } catch (e: NoImageException) {
                markMissing(dir, missing)
                Result(null, Outcome.MISSING)
            } catch (e: Exception) {
                // A refusal by the server (4xx) is about this cover; anything else is about the way
                // there, and the car's next requests should not each wait for it.
                if (!(e is ServerException && e.code in 400..499)) {
                    unreachableUntil = SystemClock.elapsedRealtime() + UNREACHABLE_PAUSE_MS
                }
                offlineLog("Cover ${cover.image} not available", e)
                Result(null, Outcome.FAILED)
            }
        } ?: run {
            unreachableUntil = SystemClock.elapsedRealtime() + UNREACHABLE_PAUSE_MS
            Result(null, Outcome.FAILED)
        }
    }

    /** The cached file of [cover], marked as used, or null; never touches the network. */
    fun cached(context: Context, cover: CoverSpec.Cover): File? {
        val file = File(File(context.cacheDir, DIR), CoverSpec.cacheName(cover))
        if (!file.isFile) return null
        file.setLastModified(System.currentTimeMillis())
        return file
    }

    /** The bytes of [cover] from the server, through the signed-in client. */
    private suspend fun fetch(api: AivinApi, cover: CoverSpec.Cover): ByteArray =
        api.imageBytes(CoverSpec.serverSegments(cover), cover.pathhash)

    /**
     * The picture as a JPEG scaled to [CoverSpec.MAX_SIDE], or null when [bytes] is not a picture. Drawn
     * on white, because a transparent PNG cover would otherwise turn black.
     */
    // UseKtx would have us use core-ktx's createBitmap; this module depends on androidx.core, not
    // core-ktx (see TileRenderer), and the platform call is the same one.
    @SuppressLint("UseKtx")
    internal fun decodeToJpeg(bytes: ByteArray): ByteArray? {
        if (bytes.isEmpty() || bytes.size > CoverSpec.MAX_IMAGE_BYTES) return null
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

    private fun markMissing(dir: File, marker: File) {
        dir.mkdirs()
        if (!marker.createNewFile()) marker.setLastModified(System.currentTimeMillis())
        prune(dir)
    }

    /**
     * Keeps the cache bounded. The provider is exported, so any app on the phone can ask for covers of
     * made-up names; without a cap each would stay on disk. The least recently used go first; the
     * markers of missing covers count too (they are empty, but each is a file).
     */
    @Synchronized
    private fun prune(dir: File) {
        val files = dir.listFiles { f -> f.isFile && (f.name.endsWith(".jpg") || f.name.endsWith(MISSING_SUFFIX)) }
            ?: return
        if (files.size <= MAX_CACHED) return
        files.sortedBy { it.lastModified() }.take(files.size - KEEP_AFTER_PRUNE).forEach { it.delete() }
    }
}
