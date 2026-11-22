package net.aivinnet.auto

import java.text.Normalizer

/**
 * The rules of search that do not need the server: how a query is cleaned up, and which downloaded
 * tracks answer it when there is no network. Pure, so they run in JVM unit tests.
 *
 * With a network the server ranks the results ([AivinApi.searchTracks]); these rules only ever see the
 * offline copies. Matching is case- and accent-insensitive, because a voice query rarely has the
 * spelling of the tag ("Beyonce" for "Beyoncé").
 */
object SearchRules {

    /** Tracks the car lists for one search: the group "Titel". */
    const val TRACK_LIMIT = 15

    /** Albums the car lists for one search: the group "Alben". */
    const val ALBUM_LIMIT = 8

    /** Searches kept for the browse and the queue of a tapped result (see [SearchCache]). */
    const val CACHED_QUERIES = 3

    private val WHITESPACE = Regex("\\s+")
    private val COMBINING_MARKS = Regex("\\p{Mn}+")

    /** The query as it is compared and cached: trimmed, inner whitespace collapsed. Empty when blank. */
    fun normalize(query: String?): String = query.orEmpty().trim().replace(WHITESPACE, " ")

    /** Lower case with the accents removed, the form both sides of a match are compared in. */
    fun fold(text: String): String =
        COMBINING_MARKS.replace(Normalizer.normalize(text, Normalizer.Form.NFD), "").lowercase()

    /**
     * How well [track] matches the folded [query]: 0 when the title is the query, 1 when the title starts
     * with it, 2 when the title contains it, 3 when only the artist or the album does, and null when none
     * of them does.
     */
    fun rank(track: TrackInfo, query: String): Int? {
        val title = fold(track.title)
        return when {
            title == query -> 0
            title.startsWith(query) -> 1
            title.contains(query) -> 2
            track.artists.any { fold(it).contains(query) } || fold(track.album).contains(query) -> 3
            else -> null
        }
    }

    /**
     * The downloaded tracks that answer [query], best first, at most [limit]. A track counts when its title,
     * an artist or its album contains the query. Ties keep the order of [candidates] (the playlist order, so
     * the list does not shuffle between two searches). A blank query finds nothing.
     */
    fun offlineMatches(query: String, candidates: List<TrackInfo>, limit: Int = TRACK_LIMIT): List<TrackInfo> {
        val needle = fold(normalize(query))
        if (needle.isEmpty()) return emptyList()
        return candidates
            .distinctBy { it.trackhash }
            .mapNotNull { track -> rank(track, needle)?.let { track to it } }
            .sortedBy { it.second }
            .map { it.first }
            .take(limit)
    }
}
