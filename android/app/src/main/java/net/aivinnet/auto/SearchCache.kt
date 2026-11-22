package net.aivinnet.auto

/** One search as the car was shown it: the tracks of the group "Titel" and the albums of "Alben". */
data class SearchResults(
    val query: String,
    val tracks: List<TrackInfo>,
    val albums: List<AlbumSummary>,
)

/**
 * The last [capacity] searches, keyed by their normalised query. A tapped search track plays the track list
 * of the newest search that holds it, so the queue is what the car showed, and next and previous work.
 *
 * Pure and small on purpose: a search is a few dozen rows, and the car only ever tries the last few. Every
 * method is [Synchronized]: the browse calls and the search calls run on different threads.
 */
class SearchCache(private val capacity: Int = SearchRules.CACHED_QUERIES) {

    /** The queue of a tapped track: the tracks to play and where the tapped one sits in them. */
    data class Queue(val tracks: List<TrackInfo>, val index: Int)

    /** Insertion order is the age of the search: the newest is last. */
    private val entries = LinkedHashMap<String, SearchResults>()

    /** Stores [results] as the newest search. A query searched again replaces its old entry. */
    @Synchronized
    fun put(results: SearchResults) {
        val key = SearchRules.normalize(results.query)
        entries.remove(key)
        entries[key] = results
        while (entries.size > capacity) {
            entries.remove(entries.keys.first())
        }
    }

    /** The results of [query], or null when that search is no longer kept. */
    @Synchronized
    fun get(query: String): SearchResults? = entries[SearchRules.normalize(query)]

    /**
     * The queue for the track [trackhash]: the track list of the newest search that holds it, starting at the
     * track. Null when no kept search holds it (it was evicted, or never searched).
     */
    @Synchronized
    fun queueOf(trackhash: String): Queue? {
        for (results in entries.values.reversed()) {
            val index = results.tracks.indexOfFirst { it.trackhash == trackhash }
            if (index >= 0) return Queue(results.tracks, index)
        }
        return null
    }
}
