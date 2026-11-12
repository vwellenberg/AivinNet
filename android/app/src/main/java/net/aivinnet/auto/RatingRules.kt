package net.aivinnet.auto

import org.json.JSONObject

/**
 * The rating button in the car: one press rates the playing track 5, a press on a track that is
 * already at 5 clears the rating. Pure, so the toggle is tested on the JVM.
 */
object RatingRules {
    const val FULL_MARK = 5

    /** The rating a press leaves behind: null (cleared) when the track is at 5, otherwise 5. */
    fun toggle(current: Int?): Int? = if (current == FULL_MARK) null else FULL_MARK
}

/**
 * A rating change the server has not confirmed yet, with the account it was made under.
 * [rating] null means "clear the rating".
 */
data class QueuedRating(val owner: String, val trackhash: String, val rating: Int?)

/** Request bodies of `POST /ratings/set` and `POST /ratings/clear` (api/ratings.py). */
object RatingJson {
    fun setBody(trackhash: String, rating: Int): String =
        JSONObject().put("trackhash", trackhash).put("rating", rating).toString()

    fun clearBody(trackhash: String): String =
        JSONObject().put("trackhash", trackhash).toString()
}
