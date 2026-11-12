package net.aivinnet.auto

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class RatingRulesTest {

    @Test
    fun `a track at 5 is cleared by the next press`() {
        assertNull(RatingRules.toggle(5))
    }

    @Test
    fun `any other state is set to 5`() {
        assertEquals(5, RatingRules.toggle(null))
        assertEquals(5, RatingRules.toggle(1))
        assertEquals(5, RatingRules.toggle(4))
    }

    @Test
    fun `set body carries the trackhash and the rating`() {
        val body = JSONObject(RatingJson.setBody("abc123", 5))

        assertEquals(setOf("trackhash", "rating"), body.keys().asSequence().toSet())
        assertEquals("abc123", body.getString("trackhash"))
        assertEquals(5, body.getInt("rating"))
    }

    @Test
    fun `clear body carries only the trackhash`() {
        val body = JSONObject(RatingJson.clearBody("abc123"))

        assertEquals(setOf("trackhash"), body.keys().asSequence().toSet())
        assertEquals("abc123", body.getString("trackhash"))
    }

    @Test
    fun `parses the rating of the server, null when unrated`() {
        assertEquals(3, AivinJson.parseRating("""{"rating":3}"""))
        assertNull(AivinJson.parseRating("""{"rating":null}"""))
    }
}
