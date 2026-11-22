package net.aivinnet.auto

import java.security.MessageDigest

/**
 * The Memphis tiles the car shows as artwork: which tile a URI names, what it shows and its colour.
 * Pure, so the validation, the label, the colour and the glyph choice run in JVM unit tests. The
 * drawing is [TileRenderer]; the URI handling is [TileProvider].
 *
 * A tile URI is `content://<package>.tiles/tile/<kind>/<key>[?name=<playlist name>]`. Nothing in it
 * is a file path: the picture is drawn from these few values, so a URI cannot reach any file.
 */
object TileSpec {

    /** The kinds of tile. [wire] is the path segment in the URI. */
    enum class Kind(val wire: String) {
        MIX("mix"),
        ROW("row"),
        STATION("station"),
        PLAYLIST("playlist"),
        OFFLINE("offline");

        companion object {
            fun of(wire: String): Kind? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** What the middle of a tile shows: a label, or a glyph given as SVG path data (256 px space). */
    sealed interface Content {
        data class Label(val text: String) : Content
        data class Glyph(val name: String, val paths: List<String>) : Content
    }

    /** One tile, fully decided: what it shows and in which colour. */
    data class Tile(val kind: Kind, val key: String, val color: Int, val content: Content)

    /** A sprinkle: a short dash on the card, at [x] and [y] in px, turned by [angleDegrees]. */
    data class Sprinkle(val x: Double, val y: Double, val angleDegrees: Double)

    /** The longest playlist name a tile URI may carry; a longer one is not a tile. */
    const val MAX_NAME = 64

    const val SPRINKLE_COUNT = 14

    /**
     * Part of every cached tile's name. Cached PNGs stay on the phone across updates, so a change to
     * the drawing ([TileRenderer]) must bump this, or the old pictures keep being served. A colour
     * change needs no bump: the colour is in the name too.
     */
    const val RENDER_VERSION = "v1"

    private val KEY = Regex("[A-Za-z0-9_-]{1,64}")

    // The design's colours. Paper is the ground, ink the outline, the shadow and the text.
    const val PAPER = 0xFFF4F2ED.toInt()
    const val INK = 0xFF17171A.toInt()

    private val TEAL = 0xFF2FBFA3.toInt()
    private val PINK = 0xFFF2799F.toInt()
    private val YELLOW = 0xFFF5B23C.toInt()
    private val CORAL = 0xFFE2574C.toInt()
    private val LAVENDER = 0xFFB8B4EE.toInt()
    private val MINT = 0xFF9ED9C6.toInt()

    /** The palette the playlists, stations and offline copies pick from, by their key. */
    private val PALETTE = listOf(TEAL, PINK, YELLOW, CORAL, LAVENDER, MINT)

    /** Mixes 1 to 4, in the order of [MediaIds.MIX_IDS]. */
    private val MIX_COLORS = listOf(TEAL, PINK, YELLOW, LAVENDER)

    private val ROW_COLORS = mapOf(
        "becauseyoulistened" to CORAL,
        "onrepeat" to YELLOW,
        "toprated" to LAVENDER,
        "recentlyplayed" to MINT,
        "forgottenfavorites" to PINK,
    )

    // The glyphs. Their paths are the design's, in the 256 px space of the card.
    private val HEART = Content.Glyph(
        "heart",
        listOf("M128 178s-48-28-48-62a26 26 0 0 1 48-14 26 26 0 0 1 48 14c0 34-48 62-48 62Z"),
    )
    private val REPEAT = Content.Glyph(
        "repeat",
        listOf("M88 112a30 30 0 0 1 30-30h42l-14-14M168 144a30 30 0 0 1-30 30H96l14 14"),
    )
    private val STAR = Content.Glyph(
        "star",
        listOf("M128 76l15 34 37 4-28 25 8 36-32-19-32 19 8-36-28-25 37-4Z"),
    )
    private val CLOCK = Content.Glyph(
        "clock",
        // The face is a circle at 128,128 with r 46, written as two arcs.
        listOf("M174 128a46 46 0 1 1-92 0a46 46 0 1 1 92 0", "M128 102v28l18 12"),
    )
    private val WAVES = Content.Glyph(
        "waves",
        listOf("M84 150c14-34 28-34 42 0s28 34 42 0", "M84 112c14-34 28-34 42 0s28 34 42 0"),
    )
    private val DOWNLOAD = Content.Glyph(
        "download",
        listOf("M128 84v70M100 128l28 28 28-28", "M90 176h76"),
    )

    /** The glyph of each home row. Every row of [MediaIds.HOME_IDS] has one. */
    private val ROW_GLYPHS = mapOf(
        "becauseyoulistened" to HEART,
        "onrepeat" to REPEAT,
        "toprated" to STAR,
        "recentlyplayed" to CLOCK,
        "forgottenfavorites" to HEART,
        "deepcuts" to WAVES,
        "onthisday" to CLOCK,
        "almostcomplete" to STAR,
        "recentlyadded" to DOWNLOAD,
    )

    /**
     * The tile a URI names, or null when it names none: an unknown kind, a key outside the allowed
     * characters or the known ids, or a name longer than [MAX_NAME]. [segments] are the decoded path
     * segments of the URI and [name] its `name` parameter.
     */
    fun parse(segments: List<String>, name: String?): Tile? {
        if (segments.size != 3 || segments[0] != "tile") return null
        val kind = Kind.of(segments[1]) ?: return null
        val key = segments[2]
        if (!KEY.matches(key)) return null
        if (name != null && name.length > MAX_NAME) return null
        return when (kind) {
            Kind.MIX -> {
                if (key !in MediaIds.MIX_IDS) return null
                Tile(kind, key, MIX_COLORS[MediaIds.MIX_IDS.indexOf(key)], Content.Label(key.removePrefix("mix")))
            }
            Kind.ROW -> {
                val glyph = ROW_GLYPHS[key] ?: return null
                Tile(kind, key, rowColor(key), glyph)
            }
            Kind.STATION -> {
                if (key !in MediaIds.STATION_IDS) return null
                Tile(kind, key, paletteColor(key), WAVES)
            }
            Kind.PLAYLIST -> Tile(kind, key, paletteColor(key), Content.Label(label(name.orEmpty())))
            Kind.OFFLINE -> Tile(kind, key, paletteColor(key), DOWNLOAD)
        }
    }

    /**
     * The letter a playlist tile shows: its first letter, or the first two when the second one is
     * lowercase ("Ch", "Ru"). A nameless playlist shows "?".
     */
    fun label(name: String): String {
        val text = name.trim()
        if (text.isEmpty()) return "?"
        val first = text.codePointAt(0)
        val firstText = String(Character.toChars(first)).uppercase()
        val afterFirst = Character.charCount(first)
        if (afterFirst >= text.length) return firstText
        val second = text.codePointAt(afterFirst)
        return if (Character.isLowerCase(second)) firstText + String(Character.toChars(second)) else firstText
    }

    /**
     * The seed of a tile's sprinkles: a stable number per kind and key, so a tile looks the same on
     * every render and every install.
     */
    fun seed(kind: Kind, key: String): Int = ("${kind.wire}:$key".hashCode() and 0x7fffffff) % 1000 + 1

    /**
     * The sprinkles of a seeded card. One linear congruential generator, three draws per sprinkle
     * (x, y, angle), so the same seed always gives the same card.
     */
    fun sprinkles(seed: Int): List<Sprinkle> {
        var state = seed.toLong()
        fun next(): Double {
            state = (state * 9301 + 49297) % 233280
            return state / 233280.0
        }
        return List(SPRINKLE_COUNT) {
            val x = 26 + next() * 160
            val y = 26 + next() * 160
            val angle = next() * 180
            Sprinkle(x, y, angle)
        }
    }

    /**
     * The file name of a tile's rendering: a hash of its kind, key and content. A label is part of
     * the identity, so two playlists with different letters never share a file.
     */
    fun cacheName(tile: Tile): String {
        val content = when (val c = tile.content) {
            is Content.Label -> "label=${c.text}"
            is Content.Glyph -> "glyph=${c.name}"
        }
        val identity = "$RENDER_VERSION|${tile.kind.wire}|${tile.key}|$content|${tile.color}"
        val digest = MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8))
        return digest.take(16).joinToString("") { "%02x".format(it.toInt() and 0xff) } + ".png"
    }

    private fun rowColor(key: String): Int =
        ROW_COLORS[key] ?: PALETTE[MediaIds.HOME_IDS.indexOf(key) % PALETTE.size]

    /**
     * The palette colour of a key. The hash is masked rather than `abs`-ed: `abs(Int.MIN_VALUE)` is
     * negative, and the mask gives the same index everywhere else.
     */
    private fun paletteColor(key: String): Int = PALETTE[(key.hashCode() and 0x7fffffff) % PALETTE.size]
}
