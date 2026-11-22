package net.aivinnet.auto

import java.security.MessageDigest

/**
 * The album and playlist covers the car shows as artwork: which cover a URI names, where the server
 * keeps it and how the file is named in the app's cache. Pure, so the validation and the naming run
 * in JVM unit tests. The fetching is [CoverCache], the URIs and the provider are [CoverProvider].
 *
 * A cover URI is `content://<package>.covers/cover/<kind>/<image>[?pathhash=<hash>]`. The image name
 * is checked by [isImageName] before anything is built from it, so no URI reaches a path outside the
 * server's image folders.
 */
object CoverSpec {

    /** The kinds of cover. [wire] is the path segment in the URI. */
    enum class Kind(val wire: String) {
        TRACK("track"),
        PLAYLIST("playlist");

        companion object {
            fun of(wire: String): Kind? = entries.firstOrNull { it.wire == wire }
        }
    }

    /** One cover, validated. [pathhash] is only set for tracks: the hash of the album's folder. */
    data class Cover(val kind: Kind, val image: String, val pathhash: String?)

    /** The query parameter of a track cover, as the server's image endpoint reads it. */
    const val PARAM_PATHHASH = "pathhash"

    /** The longest side of a cover in the car. A bigger picture is scaled down before it is cached. */
    const val MAX_SIDE = 512

    /** The largest picture the app reads at all; anything bigger is not a cover of the car's size. */
    const val MAX_IMAGE_BYTES = 8L * 1024 * 1024

    /**
     * Part of every cache name. Cached covers stay on the phone across updates, so a change to what is
     * stored (size, format) must bump this, or the old files keep being served.
     */
    const val CACHE_VERSION = "v1"

    private val IMAGE = Regex("[A-Za-z0-9_.-]{1,96}")
    private val PATHHASH = Regex("[A-Za-z0-9]{1,64}")
    private val EXTENSIONS = setOf("webp", "jpg", "jpeg", "png")

    /**
     * The cover a URI names, or null when it names none. The segments must be `cover/<kind>/<image>`,
     * the image must pass [isImageName], a track's [pathhash] must match its pattern, and a playlist
     * takes no pathhash at all.
     */
    fun parse(segments: List<String>, pathhash: String?): Cover? {
        if (segments.size != 3 || segments[0] != "cover") return null
        val kind = Kind.of(segments[1]) ?: return null
        return validated(kind, segments[2], pathhash)
    }

    /**
     * The cover of a track, from its `image` field: `<albumhash>.webp?pathhash=<hash>&fb=track`, the
     * album's file with the folder's hash to find it by (`models/track.py`). Null when the field is
     * empty or does not parse.
     */
    fun ofTrack(image: String): Cover? {
        if (image.isEmpty()) return null
        val name = image.substringBefore('?')
        val pathhash = image.substringAfter('?', "")
            .split('&')
            .firstOrNull { it.startsWith("$PARAM_PATHHASH=") }
            ?.removePrefix("$PARAM_PATHHASH=")
        return validated(Kind.TRACK, name, pathhash)
    }

    /** The cover of a playlist that has its own image (`image` with `has_image` in `GET /playlists`). */
    fun ofPlaylist(image: String): Cover? = validated(Kind.PLAYLIST, image, null)

    /** Whether [name] can be a file in the server's image folders: a safe pattern and a known extension. */
    fun isImageName(name: String): Boolean =
        IMAGE.matches(name) && ".." !in name && name.substringAfterLast('.', "") in EXTENSIONS

    private fun validated(kind: Kind, image: String, pathhash: String?): Cover? {
        if (!isImageName(image)) return null
        return when (kind) {
            Kind.TRACK -> {
                if (pathhash != null && !PATHHASH.matches(pathhash)) return null
                Cover(kind, image, pathhash)
            }
            Kind.PLAYLIST -> if (pathhash == null) Cover(kind, image, null) else null
        }
    }

    /**
     * The path segments of the server's image endpoint for [cover], built from the validated pieces only:
     * `img/thumbnail/<image>` (500 px, the size closest to the car's 512) for a track, and
     * `img/playlist/<image>` for a playlist.
     */
    fun serverSegments(cover: Cover): List<String> = when (cover.kind) {
        Kind.TRACK -> listOf("img", "thumbnail", cover.image)
        Kind.PLAYLIST -> listOf("img", "playlist", cover.image)
    }

    /**
     * The file name of [cover] in the cache: a SHA-256 of its version, kind, image and pathhash. The name
     * is stable across runs and holds nothing the server sent. The car's requests and the offline sync
     * both name files through this, so they meet on the same file.
     */
    fun cacheName(cover: Cover): String {
        val key = listOf(CACHE_VERSION, cover.kind.wire, cover.image, cover.pathhash.orEmpty())
            .joinToString("\u0000")
        val digest = MessageDigest.getInstance("SHA-256").digest(key.toByteArray(Charsets.UTF_8))
        return digest.joinToString("") { "%02x".format(it) } + ".jpg"
    }

    /** The size a [width] x [height] cover is stored at: the longest side at most [MAX_SIDE], aspect kept. */
    fun scaledSize(width: Int, height: Int): Pair<Int, Int> {
        val longest = maxOf(width, height)
        if (longest <= MAX_SIDE) return width to height
        val scale = MAX_SIDE.toDouble() / longest
        return maxOf(1, Math.round(width * scale).toInt()) to maxOf(1, Math.round(height * scale).toInt())
    }

    /**
     * The power of two to decode a [width] x [height] picture at, so the decoded longest side stays at
     * least [MAX_SIDE]. A 4000 px scan decoded at full size would take far more memory than the car needs.
     */
    fun sampleSize(width: Int, height: Int): Int {
        var sample = 1
        val longest = maxOf(width, height)
        while (longest / (sample * 2) >= MAX_SIDE) sample *= 2
        return sample
    }
}
