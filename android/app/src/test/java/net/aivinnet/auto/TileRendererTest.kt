package net.aivinnet.auto

import android.graphics.Bitmap
import android.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.io.File
import kotlin.math.abs

/**
 * Renders real tiles with Android's own graphics (Robolectric's native mode, the same Skia the
 * phone uses), checks the layers sit where the design puts them, and writes every tile as a PNG
 * to `build/tile-previews/`: the way to look at the tiles without a car.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [36])
class TileRendererTest {

    private val samples = listOf(
        listOf("tile", "mix", "mix1") to null,
        listOf("tile", "mix", "mix4") to null,
        listOf("tile", "row", "becauseyoulistened") to null,
        listOf("tile", "row", "onrepeat") to null,
        listOf("tile", "row", "toprated") to null,
        listOf("tile", "row", "recentlyplayed") to null,
        listOf("tile", "playlist", "42") to "Chill",
        listOf("tile", "playlist", "7") to "Game OSTs",
        listOf("tile", "offline", "42") to null,
    )

    private fun tile(segments: List<String>, name: String?) = requireNotNull(TileSpec.parse(segments, name))

    @Test
    fun `every sample renders at 256 px and is written as a preview`() {
        val out = File("build/tile-previews").apply { mkdirs() }
        for ((segments, name) in samples) {
            val bitmap = TileRenderer.render(tile(segments, name))
            assertEquals(TileRenderer.SIZE, bitmap.width)
            assertEquals(TileRenderer.SIZE, bitmap.height)
            File(out, segments.drop(1).joinToString("-") + ".png").outputStream().use {
                bitmap.compress(Bitmap.CompressFormat.PNG, 100, it)
            }
        }
    }

    @Test
    fun `the layers sit where the design puts them`() {
        val t = tile(listOf("tile", "mix", "mix1"), null)
        val bitmap = TileRenderer.render(t)
        // Outside the card: the paper ground (a grid line is not on these pixels).
        assertClose(TileSpec.PAPER, bitmap.getPixel(10, 10))
        // The hard shadow right of the card (on its straight edge; the corners are rounded).
        assertClose(TileSpec.INK, bitmap.getPixel(224, 121))
        // The card's inked edge.
        assertClose(TileSpec.INK, bitmap.getPixel(121, 27))
        // Inside the card, away from label and edge: the tile's colour, unless a sprinkle sits there.
        val inside = listOf(bitmap.getPixel(60, 190), bitmap.getPixel(190, 60), bitmap.getPixel(60, 60))
        assertTrue("card colour not found in $inside", inside.any { close(t.color, it) })
    }

    private fun close(expected: Int, actual: Int): Boolean =
        abs(Color.red(expected) - Color.red(actual)) <= 6 &&
            abs(Color.green(expected) - Color.green(actual)) <= 6 &&
            abs(Color.blue(expected) - Color.blue(actual)) <= 6

    private fun assertClose(expected: Int, actual: Int) =
        assertTrue("expected #%08x, got #%08x".format(expected, actual), close(expected, actual))
}
