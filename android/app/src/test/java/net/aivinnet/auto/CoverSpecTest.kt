package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.assertFalse
import org.junit.Test

class CoverSpecTest {

    private val album = "0123456789abcdef.webp"

    private fun cover(vararg segments: String, pathhash: String? = null) =
        CoverSpec.parse(segments.toList(), pathhash)

    @Test
    fun `a track cover and a playlist cover parse`() {
        assertEquals(
            CoverSpec.Cover(CoverSpec.Kind.TRACK, album, "abc123"),
            cover("cover", "track", album, pathhash = "abc123"),
        )
        assertEquals(
            CoverSpec.Cover(CoverSpec.Kind.PLAYLIST, "42.png", null),
            cover("cover", "playlist", "42.png"),
        )
    }

    @Test
    fun `a track cover needs no pathhash`() {
        assertEquals(CoverSpec.Cover(CoverSpec.Kind.TRACK, album, null), cover("cover", "track", album))
    }

    @Test
    fun `every allowed extension is accepted`() {
        for (ext in listOf("webp", "jpg", "jpeg", "png")) {
            assertTrue(ext, CoverSpec.isImageName("cover.$ext"))
        }
    }

    @Test
    fun `wrong shapes and kinds are refused`() {
        assertNull(cover("tile", "track", album))
        assertNull(cover("cover", "album", album))
        assertNull(cover("cover", "track"))
        assertNull(cover("cover", "track", album, "extra"))
        assertNull(cover("cover", "TRACK", album))
    }

    @Test
    fun `extensions outside the list are refused`() {
        assertNull(cover("cover", "track", "cover.gif"))
        assertNull(cover("cover", "track", "cover.svg"))
        assertNull(cover("cover", "track", "cover"))
        assertNull(cover("cover", "track", "cover.webp.exe"))
    }

    @Test
    fun `path traversal is refused`() {
        assertNull(cover("cover", "track", "../secret.webp"))
        assertNull(cover("cover", "track", "..webp"))
        assertNull(cover("cover", "track", "a..b.webp"))
        assertNull(cover("cover", "playlist", "..%2Fsecret.webp"))
    }

    @Test
    fun `separators and odd characters are refused`() {
        assertNull(cover("cover", "track", "sub/cover.webp"))
        assertNull(cover("cover", "track", "sub\\cover.webp"))
        assertNull(cover("cover", "track", "cover name.webp"))
        assertNull(cover("cover", "track", "cover\u0000.webp"))
        assertNull(cover("cover", "track", "/etc/passwd.jpg"))
    }

    @Test
    fun `an overlong image name is refused, the longest accepted`() {
        val longest = "a".repeat(96 - 5) + ".webp"
        assertEquals(96, longest.length)
        assertTrue(CoverSpec.isImageName(longest))
        assertFalse(CoverSpec.isImageName("a".repeat(96 - 4) + ".webp"))
    }

    @Test
    fun `a bad pathhash is refused, an absent one is fine`() {
        assertNull(cover("cover", "track", album, pathhash = ""))
        assertNull(cover("cover", "track", album, pathhash = "abc-123"))
        assertNull(cover("cover", "track", album, pathhash = "../x"))
        assertNull(cover("cover", "track", album, pathhash = "a".repeat(65)))
        assertEquals(64, cover("cover", "track", album, pathhash = "a".repeat(64))?.pathhash?.length)
    }

    @Test
    fun `a playlist takes no pathhash`() {
        assertNull(cover("cover", "playlist", "42.webp", pathhash = "abc123"))
    }

    @Test
    fun `the track image of the server keeps its name and pathhash apart`() {
        assertEquals(
            CoverSpec.Cover(CoverSpec.Kind.TRACK, album, "abc123"),
            CoverSpec.ofTrack("$album?pathhash=abc123&fb=track"),
        )
        assertEquals(CoverSpec.Cover(CoverSpec.Kind.TRACK, album, null), CoverSpec.ofTrack(album))
        assertNull(CoverSpec.ofTrack(""))
        assertNull(CoverSpec.ofTrack("../x.webp?pathhash=abc"))
        assertNull(CoverSpec.ofTrack("$album?pathhash=ab%2Fc"))
    }

    @Test
    fun `the playlist image of the server is its name`() {
        assertEquals(CoverSpec.Cover(CoverSpec.Kind.PLAYLIST, "7.webp", null), CoverSpec.ofPlaylist("7.webp"))
        assertNull(CoverSpec.ofPlaylist("None"))
        assertNull(CoverSpec.ofPlaylist("../7.webp"))
    }

    @Test
    fun `the server path is built from the validated pieces only`() {
        assertEquals(
            listOf("img", "thumbnail", album),
            CoverSpec.serverSegments(CoverSpec.Cover(CoverSpec.Kind.TRACK, album, "abc123")),
        )
        assertEquals(
            listOf("img", "playlist", "42.webp"),
            CoverSpec.serverSegments(CoverSpec.Cover(CoverSpec.Kind.PLAYLIST, "42.webp", null)),
        )
    }

    @Test
    fun `the cache name is stable and holds nothing the server sent`() {
        // The reference values are SHA-256 over "v1", kind, image and pathhash, NUL separated (sha256sum).
        assertEquals(
            "3798e18093beb9d585669bc00318a5bd921529416b47bc82bfebe30d4e68de6f.jpg",
            CoverSpec.cacheName(CoverSpec.Cover(CoverSpec.Kind.TRACK, "0123456789abcdef.webp", "abc123")),
        )
        assertEquals(
            "c2d8df947d1fd2c0f0e131693d7572fc0be5912a174f941c0c3c27de2cdca51b.jpg",
            CoverSpec.cacheName(CoverSpec.Cover(CoverSpec.Kind.PLAYLIST, "42.webp", null)),
        )
    }

    @Test
    fun `the cache name tells covers apart by kind, image and pathhash`() {
        val names = listOf(
            CoverSpec.Cover(CoverSpec.Kind.TRACK, album, "abc123"),
            CoverSpec.Cover(CoverSpec.Kind.TRACK, album, "abc124"),
            CoverSpec.Cover(CoverSpec.Kind.TRACK, album, null),
            CoverSpec.Cover(CoverSpec.Kind.TRACK, "other.webp", "abc123"),
            CoverSpec.Cover(CoverSpec.Kind.PLAYLIST, album, null),
        ).map(CoverSpec::cacheName)
        assertEquals(names.size, names.toSet().size)
    }

    @Test
    fun `the scaled size keeps the aspect and caps the long side at 512`() {
        assertEquals(512 to 256, CoverSpec.scaledSize(1200, 600))
        assertEquals(256 to 512, CoverSpec.scaledSize(600, 1200))
        assertEquals(512 to 512, CoverSpec.scaledSize(4000, 4000))
        assertEquals(300 to 200, CoverSpec.scaledSize(300, 200))
        assertEquals(1 to 512, CoverSpec.scaledSize(1, 10000))
    }

    @Test
    fun `the decode sample keeps the decoded long side at least 512`() {
        assertEquals(1, CoverSpec.sampleSize(900, 900))
        assertEquals(2, CoverSpec.sampleSize(1100, 900))
        assertEquals(4, CoverSpec.sampleSize(3000, 2000))
        assertEquals(4, CoverSpec.sampleSize(4000, 4000))
    }
}
