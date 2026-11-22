package net.aivinnet.auto

import java.io.IOException

/**
 * Which browse folders were last answered from the offline copies, so they can be asked again once
 * the server is reachable.
 *
 * Android Auto caches every browse answer and asks again only when the service says the folder has
 * changed. Without this, a folder answered offline in a dead spot stayed offline for the whole drive.
 * The ids are the parent ids of the browse calls: `mixes`, `playlists` and `pl:<id>`.
 *
 * Browse calls run on Dispatchers.IO, so every method is synchronized.
 */
class BrowseFreshness {

    companion object {
        /**
         * Whether a browse answered with [failure] (null: the offline copy stood in) is asked again
         * once the server is back. A refusal does not count: a 4xx (a deleted playlist) or an expired
         * login would answer the same again, and while the server answers the probe, the car would
         * be told to reload every 30 s. A 5xx and a network error count.
         */
        fun retries(failure: IOException?): Boolean = when (failure) {
            is AuthExpiredException -> false
            is ServerException -> failure.code !in 400..499
            else -> true
        }
    }

    /** Insertion order, so the folders are told about in the order they were shown. */
    private val stale = LinkedHashSet<String>()

    /** [parentId] was answered from the offline copy. */
    @Synchronized
    fun markOffline(parentId: String) {
        stale += parentId
    }

    /** [parentId] was answered by the server, so the car's copy is current again. */
    @Synchronized
    fun markOnline(parentId: String) {
        stale -= parentId
    }

    /** The ids answered offline. Clears them, so each one is returned once until it is marked again. */
    @Synchronized
    fun takeStale(): List<String> {
        val out = stale.toList()
        stale.clear()
        return out
    }

    @Synchronized
    fun hasStale(): Boolean = stale.isNotEmpty()
}
