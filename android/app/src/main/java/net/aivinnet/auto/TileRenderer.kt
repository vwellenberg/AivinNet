package net.aivinnet.auto

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import androidx.core.graphics.PathParser
import kotlin.math.cos
import kotlin.math.sin

/**
 * Draws a tile at 256 x 256 px, following the design: a paper grid, a hard shadow, the card in its
 * colour with an inked edge, sprinkles, and the label or glyph in the middle. The coordinates are the
 * design's; the card's centre is (121, 121). Only this file touches the drawing API; the rules are in
 * [TileSpec].
 */
object TileRenderer {

    const val SIZE = 256

    private const val CENTRE = 121f

    fun render(tile: TileSpec.Tile): Bitmap {
        val bitmap = Bitmap.createBitmap(SIZE, SIZE, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        canvas.drawColor(TileSpec.PAPER)
        drawGrid(canvas)
        fillRoundRect(canvas, RectF(40f, 40f, 230f, 230f), TileSpec.INK)
        fillRoundRect(canvas, RectF(26f, 26f, 216f, 216f), tile.color)
        strokeCard(canvas)
        drawSprinkles(canvas, tile)
        when (val content = tile.content) {
            is TileSpec.Content.Label -> drawLabel(canvas, content.text)
            is TileSpec.Content.Glyph -> drawGlyph(canvas, content.paths)
        }
        return bitmap
    }

    /** Lines every 32 px both ways, in ink at 8 % (alpha 0x14). */
    private fun drawGrid(canvas: Canvas) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 2f
            color = withAlpha(TileSpec.INK, 0x14)
        }
        for (i in 0..SIZE step 32) {
            canvas.drawLine(i.toFloat(), 0f, i.toFloat(), SIZE.toFloat(), paint)
            canvas.drawLine(0f, i.toFloat(), SIZE.toFloat(), i.toFloat(), paint)
        }
    }

    private fun fillRoundRect(canvas: Canvas, rect: RectF, color: Int) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.FILL
            this.color = color
        }
        canvas.drawRoundRect(rect, CORNER, CORNER, paint)
    }

    private fun strokeCard(canvas: Canvas) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 8f
            color = TileSpec.INK
        }
        canvas.drawRoundRect(RectF(26f, 26f, 216f, 216f), CORNER, CORNER, paint)
    }

    /** Short dashes of 9 px, turned by their angle, at 30 % ink. */
    private fun drawSprinkles(canvas: Canvas, tile: TileSpec.Tile) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 3f
            strokeCap = Paint.Cap.ROUND
            color = withAlpha(TileSpec.INK, 0x4D)
        }
        val half = DASH / 2.0
        for (s in TileSpec.sprinkles(TileSpec.seed(tile.kind, tile.key))) {
            val radians = Math.toRadians(s.angleDegrees)
            val dx = (cos(radians) * half).toFloat()
            val dy = (sin(radians) * half).toFloat()
            canvas.drawLine((s.x - dx).toFloat(), (s.y - dy).toFloat(), (s.x + dx).toFloat(), (s.y + dy).toFloat(), paint)
        }
    }

    /** Bold sans, centred on the card. One letter is the largest, more letters smaller. */
    private fun drawLabel(canvas: Canvas, text: String) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = TileSpec.INK
            typeface = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
            textAlign = Paint.Align.CENTER
            textSize = when (text.codePointCount(0, text.length)) {
                1 -> 104f
                2 -> 78f
                else -> 62f
            }
        }
        // The baseline that puts the middle of the text's ascent and descent on the centre line.
        val metrics = paint.fontMetrics
        val baseline = CENTRE - (metrics.ascent + metrics.descent) / 2f
        canvas.drawText(text, CENTRE, baseline, paint)
    }

    /** The glyph's paths in ink, 10 px wide with round ends, moved by (-6, -6) as the design has it. */
    private fun drawGlyph(canvas: Canvas, paths: List<String>) {
        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            style = Paint.Style.STROKE
            strokeWidth = 10f
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
            color = TileSpec.INK
        }
        for (d in paths) {
            canvas.save()
            canvas.translate(-6f, -6f)
            canvas.drawPath(PathParser.createPathFromPathData(d), paint)
            canvas.restore()
        }
    }

    private fun withAlpha(color: Int, alpha: Int): Int = Color.argb(
        alpha,
        Color.red(color),
        Color.green(color),
        Color.blue(color),
    )

    private const val CORNER = 26f
    private const val DASH = 9.0
}
