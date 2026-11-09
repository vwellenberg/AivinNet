package net.aivinnet.auto

import java.io.File
import java.io.FileOutputStream
import java.io.IOException

/** Where a non-fatal problem is reported. The app's own logger in production, a list in tests. */
typealias ErrorLog = (message: String, cause: Throwable?) -> Unit

/**
 * A small JSON document on disk.
 *
 * Writes go to a temp file that is flushed and then renamed over the old one, so a crash or a full
 * disk leaves either the old document or the new one, never a mix. A missing or broken file reads
 * as [empty]: the app starts with nothing rather than crashing on its own state, and the loss is
 * logged. Everything is synchronised because the UI, the sync worker and the playback service all
 * write the same file in one process.
 */
class JsonFile<T>(
    private val file: File,
    private val empty: T,
    private val decode: (String) -> T,
    private val encode: (T) -> String,
    private val log: ErrorLog,
) {
    @Synchronized
    fun load(): T {
        if (!file.exists()) return empty
        return try {
            decode(file.readText(Charsets.UTF_8))
        } catch (e: Exception) {
            log("${file.name} is unreadable, starting empty", e)
            empty
        }
    }

    @Synchronized
    @Throws(IOException::class)
    fun save(value: T) {
        file.parentFile?.mkdirs()
        val tmp = File(file.parentFile, file.name + ".tmp")
        FileOutputStream(tmp).use { out ->
            out.write(encode(value).toByteArray(Charsets.UTF_8))
            out.flush()
            out.fd.sync()
        }
        if (!tmp.renameTo(file)) {
            // renameTo may refuse to replace on some filesystems. Drop the old file and try once more.
            file.delete()
            if (!tmp.renameTo(file)) throw IOException("Could not replace ${file.name}")
        }
    }

    /** Read, change and write under one lock, so two writers cannot lose each other's change. */
    @Synchronized
    @Throws(IOException::class)
    fun update(change: (T) -> T): T = change(load()).also { save(it) }
}
