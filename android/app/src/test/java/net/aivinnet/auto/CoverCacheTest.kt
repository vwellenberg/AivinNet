package net.aivinnet.auto

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.ByteArrayOutputStream

/**
 * The cover pipeline's picture step with Android's own codecs (Robolectric's native mode): a large
 * cover comes out as a JPEG with its long side at most 512 px and its aspect kept.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class CoverCacheTest {

    private fun png(width: Int, height: Int, color: Int = Color.RED): ByteArray {
        val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888).apply { eraseColor(color) }
        return ByteArrayOutputStream().use { out ->
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, out)
            bitmap.recycle()
            out.toByteArray()
        }
    }

    private fun sizeOf(jpeg: ByteArray): Pair<Int, Int> {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size, bounds)
        return bounds.outWidth to bounds.outHeight
    }

    @Test
    fun `a wide cover is scaled to 512 px on the long side and keeps its aspect`() {
        val jpeg = requireNotNull(CoverCache.decodeToJpeg(png(1200, 600)))

        assertEquals(512 to 256, sizeOf(jpeg))
        assertTrue(jpeg.size < 200_000)
    }

    @Test
    fun `a tall cover is scaled by its height`() {
        val jpeg = requireNotNull(CoverCache.decodeToJpeg(png(600, 1800)))

        assertEquals(171 to 512, sizeOf(jpeg))
    }

    @Test
    fun `a small cover is not enlarged`() {
        val jpeg = requireNotNull(CoverCache.decodeToJpeg(png(300, 200)))

        assertEquals(300 to 200, sizeOf(jpeg))
    }

    @Test
    fun `a transparent cover comes out on white, not black`() {
        val jpeg = requireNotNull(CoverCache.decodeToJpeg(png(64, 64, Color.TRANSPARENT)))
        val decoded = requireNotNull(BitmapFactory.decodeByteArray(jpeg, 0, jpeg.size))

        val corner = decoded.getPixel(2, 2)
        assertTrue("corner was $corner", Color.red(corner) > 240 && Color.green(corner) > 240 && Color.blue(corner) > 240)
    }

    @Test
    fun `bytes that are not a picture are refused`() {
        assertNull(CoverCache.decodeToJpeg("<html>login</html>".toByteArray()))
        assertNull(CoverCache.decodeToJpeg(ByteArray(0)))
    }
}
