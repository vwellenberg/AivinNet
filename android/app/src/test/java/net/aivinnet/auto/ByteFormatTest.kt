package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class ByteFormatTest {

    private val mb = 1024L * 1024L
    private val gb = 1024L * mb

    @Test
    fun `nothing downloaded reads as zero megabytes`() {
        assertEquals("0 MB", ByteFormat.storage(0))
    }

    @Test
    fun `megabytes are whole numbers below a gigabyte`() {
        assertEquals("1 MB", ByteFormat.storage(1_500_000))
        assertEquals("512 MB", ByteFormat.storage(512 * mb))
        assertEquals("1023 MB", ByteFormat.storage(1023 * mb + 900 * 1024))
    }

    @Test
    fun `gigabytes get one decimal in German notation`() {
        assertEquals("1,0 GB", ByteFormat.storage(gb))
        assertEquals("2,5 GB", ByteFormat.storage(5 * gb / 2))
    }

    @Test
    fun `a negative size is treated as zero`() {
        assertEquals("0 MB", ByteFormat.storage(-42))
    }
}
