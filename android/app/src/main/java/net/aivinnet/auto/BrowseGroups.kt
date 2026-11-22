package net.aivinnet.auto

/**
 * The headings the car shows above groups of browse items. Pure, so the grouping is testable; the
 * German texts are looked up from the resources by [BrowseItems.heading].
 */
object BrowseGroups {

    /** [TRACKS] and [ALBUMS] are the two groups of a search result. */
    enum class Heading { PINNED, ALL_PLAYLISTS, FOR_YOU, MIXES, STATIONS, TRACKS, ALBUMS }

    /** Items that sit under one heading. [heading] is null when the list has no headings at all. */
    data class Group<T>(val heading: Heading?, val items: List<T>)

    /**
     * The playlists of the Playlists folder: the pinned ones first under [Heading.PINNED], then the
     * rest under [Heading.ALL_PLAYLISTS]. Each group keeps the server's order, which is alphabetical.
     *
     * Without any pinned playlist there are no headings at all: a heading above a single group
     * would only push the list down the screen.
     */
    fun <T> playlists(items: List<T>, isPinned: (T) -> Boolean): List<Group<T>> {
        val pinned = items.filter(isPinned)
        return when {
            items.isEmpty() -> emptyList()
            pinned.isEmpty() -> listOf(Group(heading = null, items = items))
            else -> listOfNotNull(
                Group(Heading.PINNED, pinned),
                items.filterNot(isPinned).takeIf { it.isNotEmpty() }?.let { Group(Heading.ALL_PLAYLISTS, it) },
            )
        }
    }
}
