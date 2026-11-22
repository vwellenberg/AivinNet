package net.aivinnet.auto

import android.content.Context
import android.graphics.Bitmap
import android.os.SystemClock
import org.robolectric.RuntimeEnvironment
import java.io.ByteArrayOutputStream
import java.io.File
import java.net.SocketTimeoutException
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What [CoverCache.ensure] answers, with the fetch replaced: the review of the cover PR found that a
 * cover the server does not have was treated like a network failure (fetched again on every browse,
 * and three in a row stopped the offline prefetch at the same place on every run), and that a server
 * out of reach let every one of the car's requests wait out its deadline.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class CoverOutcomeTest {

    private val context: Context = RuntimeEnvironment.getApplication()
    private val cover = requireNotNull(CoverSpec.parse(listOf("cover", "track", "0123abcd.webp"), "f00d"))
    private var fetches = 0

    @Before
    fun clean() {
        File(context.cacheDir, "covers").deleteRecursively()
        CoverCache.unreachableUntil = 0L
    }

    @After
    fun reset() {
        CoverCache.unreachableUntil = 0L
    }

    private fun png(): ByteArray {
        val bitmap = Bitmap.createBitmap(40, 40, Bitmap.Config.ARGB_8888)
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            out.toByteArray()
        }
    }

    private fun ensure(fetchWhenUnreachable: Boolean = false, fetch: suspend () -> ByteArray) = runBlocking {
        CoverCache.ensure(context, cover, 4_000L, fetchWhenUnreachable) {
            fetches++
            fetch()
        }
    }

    @Test
    fun `a fetched cover is cached and served without a second fetch`() {
        val first = ensure { png() }
        assertEquals(CoverCache.Outcome.CACHED, first.outcome)
        assertNotNull(first.file)
        val second = ensure { error("must not fetch") }
        assertEquals(CoverCache.Outcome.CACHED, second.outcome)
        assertEquals(1, fetches)
    }

    @Test
    fun `a cover the server does not have is missing, remembered, and not fetched again`() {
        assertEquals(CoverCache.Outcome.MISSING, ensure { throw NoImageException("placeholder") }.outcome)
        assertEquals(CoverCache.Outcome.MISSING, ensure { error("must not fetch") }.outcome)
        assertEquals(1, fetches)
        // Not a failure to reach the server: the car's next covers are still fetched.
        assertEquals(0L, CoverCache.unreachableUntil)
    }

    @Test
    fun `a network failure pauses the car's fetches, but not the offline prefetch`() {
        assertEquals(CoverCache.Outcome.FAILED, ensure { throw SocketTimeoutException("timeout") }.outcome)
        assertTrue(CoverCache.unreachableUntil > SystemClock.elapsedRealtime())

        // The car: answered from the cache at once, no fetch.
        assertEquals(CoverCache.Outcome.FAILED, ensure { error("must not fetch") }.outcome)
        assertEquals(1, fetches)

        // The prefetch keeps trying (it has its own limit of failures in a row).
        assertEquals(CoverCache.Outcome.CACHED, ensure(fetchWhenUnreachable = true) { png() }.outcome)
        assertEquals(2, fetches)
    }

    @Test
    fun `a refusal of this one cover does not pause the others`() {
        assertEquals(CoverCache.Outcome.FAILED, ensure { throw ServerException(403, "forbidden") }.outcome)
        assertEquals(0L, CoverCache.unreachableUntil)
    }

    @Test
    fun `bytes that are no picture fail without a file`() {
        val result = ensure { "not an image".toByteArray() }
        assertEquals(CoverCache.Outcome.FAILED, result.outcome)
        assertNull(result.file)
    }
}
