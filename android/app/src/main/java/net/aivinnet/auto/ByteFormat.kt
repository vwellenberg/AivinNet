package net.aivinnet.auto

import java.util.Locale

/** Storage sizes for the phone screen. Pure, so the formatting is testable on the JVM. */
object ByteFormat {
    private const val MB = 1024L * 1024L
    private const val GB = 1024L * MB

    /** Megabytes below one gigabyte (whole numbers), gigabytes with one decimal, German notation. */
    fun storage(bytes: Long): String {
        val safe = maxOf(0L, bytes)
        return if (safe >= GB) {
            String.format(Locale.GERMAN, "%.1f GB", safe.toDouble() / GB)
        } else {
            String.format(Locale.GERMAN, "%d MB", safe / MB)
        }
    }
}
