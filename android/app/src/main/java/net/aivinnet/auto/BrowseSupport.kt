package net.aivinnet.auto

/**
 * Keeps each playlist as it was last shown, so a tap plays exactly the list the car displayed.
 *
 * Mixes (`mix1`..`mix4`) are slots the server refills: fetching the playlist again between
 * browsing and tapping can return other tracks, and the tapped one would no longer be found. The
 * cache also saves a second full download per tap on mobile data. Plain Kotlin with an injected
 * clock, so it is testable without Android; callers synchronise on the instance.
 */
class PlaylistCache(
    private val ttlMs: Long = DEFAULT_TTL_MS,
    private val now: () -> Long,
) {
    private val entries = HashMap<String, Pair<Long, PlaylistDetail?>>()

    /** The cached entry, or null when there is none or it is too old. A cached 404 is `Hit(null)`. */
    @Synchronized
    fun get(id: String): Hit? {
        val (at, detail) = entries[id] ?: return null
        if (now() - at > ttlMs) {
            entries.remove(id)
            return null
        }
        return Hit(detail)
    }

    @Synchronized
    fun put(id: String, detail: PlaylistDetail?) {
        entries[id] = now() to detail
    }

    @Synchronized
    fun clear() = entries.clear()

    data class Hit(val detail: PlaylistDetail?)

    companion object {
        const val DEFAULT_TTL_MS = 10 * 60 * 1000L
    }
}

/** Paging of browse results, and the cap that keeps one Binder answer small. */
object Paging {

    /**
     * Most tracks one browse answer lists. Legacy browsers (Android Auto) ask without paging,
     * and a playlist of thousands in one Binder transaction can fail with
     * TransactionTooLargeException. The queue that plays still holds the whole playlist.
     */
    const val MAX_BROWSE_ITEMS = 500

    /** Page [page] of size [pageSize] (legacy browsers send Int.MAX_VALUE); 0 or less = everything. */
    fun <T> slice(items: List<T>, page: Int, pageSize: Int): List<T> {
        val capped = items.take(MAX_BROWSE_ITEMS)
        if (pageSize <= 0) return capped
        val from = page.toLong() * pageSize
        if (page < 0 || from >= capped.size) return emptyList()
        val to = minOf(capped.size.toLong(), from + pageSize)
        return capped.subList(from.toInt(), to.toInt())
    }
}
