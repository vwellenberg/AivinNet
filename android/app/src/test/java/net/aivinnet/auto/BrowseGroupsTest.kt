package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Test

class BrowseGroupsTest {

    /** A playlist name and whether it is pinned; the pure grouping only looks at the flag. */
    private data class Item(val name: String, val pinned: Boolean)

    @Test
    fun `pinned playlists come first under their heading, the rest under the other one`() {
        val items = listOf(
            Item("Abend", pinned = false),
            Item("Roadtrip", pinned = true),
            Item("Zuletzt", pinned = false),
            Item("Bach", pinned = true),
        )

        val groups = BrowseGroups.playlists(items) { it.pinned }

        assertEquals(BrowseGroups.Heading.PINNED, groups[0].heading)
        assertEquals(listOf("Roadtrip", "Bach"), groups[0].items.map { it.name })
        assertEquals(BrowseGroups.Heading.ALL_PLAYLISTS, groups[1].heading)
        assertEquals(listOf("Abend", "Zuletzt"), groups[1].items.map { it.name })
    }

    @Test
    fun `without any pinned playlist there are no headings at all`() {
        val items = listOf(Item("Abend", pinned = false), Item("Zuletzt", pinned = false))

        val groups = BrowseGroups.playlists(items) { it.pinned }

        assertEquals(1, groups.size)
        assertEquals(null, groups.single().heading)
        assertEquals(items, groups.single().items)
    }

    @Test
    fun `when everything is pinned only the pinned heading is shown`() {
        val items = listOf(Item("A", pinned = true), Item("B", pinned = true))

        val groups = BrowseGroups.playlists(items) { it.pinned }

        assertEquals(listOf(BrowseGroups.Heading.PINNED), groups.map { it.heading })
        assertEquals(items, groups.single().items)
    }

    @Test
    fun `an empty list has no groups`() {
        assertEquals(emptyList<BrowseGroups.Group<Item>>(), BrowseGroups.playlists(emptyList<Item>()) { it.pinned })
    }
}
