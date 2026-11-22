package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * An album's `image` (models/album.py: `<albumhash>.webp?pathhash=<hash>`) has the track form without the
 * `&fb=track` suffix, so an album cover is a track cover ([CoverSpec.Kind.TRACK]) and needs no kind of its own.
 */
class AlbumCoverSpecTest {

    @Test
    fun `an album image is a track cover of the album's folder`() {
        val cover = CoverSpec.ofTrack("b2c3d4e5.webp?pathhash=f00d")

        assertEquals(CoverSpec.Cover(CoverSpec.Kind.TRACK, "b2c3d4e5.webp", "f00d"), cover)
        assertEquals(listOf("img", "thumbnail", "b2c3d4e5.webp"), CoverSpec.serverSegments(cover!!))
    }

    @Test
    fun `an album without an image has no cover`() {
        assertNull(CoverSpec.ofTrack(""))
    }

    @Test
    fun `an album image with a hostile name is refused`() {
        assertNull(CoverSpec.ofTrack("../../etc/passwd.webp?pathhash=f00d"))
    }
}
