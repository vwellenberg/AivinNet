package net.aivinnet.auto

import net.aivinnet.auto.TileSpec.Content
import net.aivinnet.auto.TileSpec.Kind
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TileSpecTest {

    private fun parse(vararg segments: String, name: String? = null) =
        TileSpec.parse(segments.toList(), name)

    @Test
    fun `a mix shows its number, in its own colour`() {
        val tile = parse("tile", "mix", "mix2")!!

        assertEquals(Content.Label("2"), tile.content)
        assertEquals(Kind.MIX, tile.kind)
        assertNotEquals(parse("tile", "mix", "mix1")!!.color, tile.color)
    }

    @Test
    fun `a mix that does not exist is no tile`() {
        assertNull(parse("tile", "mix", "mix9"))
    }

    @Test
    fun `a home row shows its glyph, and rows share one where the design does`() {
        assertEquals("repeat", (parse("tile", "row", "onrepeat")!!.content as Content.Glyph).name)
        assertEquals("heart", (parse("tile", "row", "becauseyoulistened")!!.content as Content.Glyph).name)
        assertEquals("heart", (parse("tile", "row", "forgottenfavorites")!!.content as Content.Glyph).name)
    }

    @Test
    fun `every home row has a glyph`() {
        for (id in MediaIds.HOME_IDS) {
            assertTrue("no glyph for $id", parse("tile", "row", id)?.content is Content.Glyph)
        }
    }

    @Test
    fun `an unknown home row is no tile`() {
        assertNull(parse("tile", "row", "nope"))
    }

    @Test
    fun `stations and offline copies have their glyphs`() {
        assertEquals("waves", (parse("tile", "station", "genre2")!!.content as Content.Glyph).name)
        assertEquals("download", (parse("tile", "offline", "7")!!.content as Content.Glyph).name)
        assertNull(parse("tile", "station", "genre9"))
    }

    @Test
    fun `a playlist shows the letter of its name, two when the second is lowercase`() {
        assertEquals(Content.Label("Ch"), parse("tile", "playlist", "7", name = "Chill")!!.content)
        assertEquals(Content.Label("R"), parse("tile", "playlist", "7", name = "ROCK")!!.content)
        assertEquals(Content.Label("8"), parse("tile", "playlist", "7", name = "80er")!!.content)
    }

    @Test
    fun `label takes the letters of the name, trims it and falls back to a question mark`() {
        assertEquals("Ru", TileSpec.label("  ruhig & leise "))
        assertEquals("?", TileSpec.label("   "))
        assertEquals("A", TileSpec.label("A"))
    }

    @Test
    fun `a playlist name longer than the limit is refused`() {
        val long = "x".repeat(TileSpec.MAX_NAME + 1)

        assertNull(parse("tile", "playlist", "7", name = long))
        assertTrue(parse("tile", "playlist", "7", name = "x".repeat(TileSpec.MAX_NAME)) != null)
    }

    @Test
    fun `keys outside the allowed characters are refused, whatever the kind`() {
        assertNull(parse("tile", "playlist", "../../etc"))
        assertNull(parse("tile", "playlist", "a%2Fb"))
        assertNull(parse("tile", "playlist", "x".repeat(65)))
        assertNull(parse("tile", "playlist", ""))
    }

    @Test
    fun `the kind and the shape of the path are fixed`() {
        assertNull(parse("tile", "file", "7"))
        assertNull(parse("tile", "playlist"))
        assertNull(parse("tile", "playlist", "7", "extra"))
        assertNull(parse("other", "playlist", "7"))
    }

    @Test
    fun `the palette colour of a key is stable`() {
        val first = parse("tile", "playlist", "7")!!.color
        assertEquals(first, parse("tile", "playlist", "7", name = "anything")!!.color)
    }

    @Test
    fun `the sprinkles come from the seed and stay on the card`() {
        val a = TileSpec.sprinkles(42)
        val b = TileSpec.sprinkles(42)

        assertEquals(TileSpec.SPRINKLE_COUNT, a.size)
        assertEquals(a, b)
        assertNotEquals(a, TileSpec.sprinkles(43))
        for (s in a) {
            assertTrue(s.x in 26.0..186.0)
            assertTrue(s.y in 26.0..186.0)
            assertTrue(s.angleDegrees in 0.0..180.0)
        }
    }

    @Test
    fun `the first sprinkle follows the generator by hand`() {
        // s = (1 * 9301 + 49297) % 233280 = 58598, so r = 58598 / 233280 for x.
        val first = TileSpec.sprinkles(1).first()

        assertEquals(26 + 58598 / 233280.0 * 160, first.x, 1e-9)
    }

    @Test
    fun `the cache name is a png name that depends on the content`() {
        val mix = parse("tile", "mix", "mix1")!!
        val playlistA = parse("tile", "playlist", "7", name = "Alpha")!!
        val playlistB = parse("tile", "playlist", "7", name = "Beta")!!

        assertTrue(TileSpec.cacheName(mix).endsWith(".png"))
        assertNotEquals(TileSpec.cacheName(playlistA), TileSpec.cacheName(playlistB))
        assertEquals(TileSpec.cacheName(playlistA), TileSpec.cacheName(playlistA))
    }

    @Test
    fun `a colour change gives a tile a new cache name, so the old picture is not served`() {
        val tile = requireNotNull(TileSpec.parse(listOf("tile", "mix", "mix1"), null))
        val recoloured = tile.copy(color = TileSpec.INK)
        org.junit.Assert.assertNotEquals(TileSpec.cacheName(tile), TileSpec.cacheName(recoloured))
    }
}
