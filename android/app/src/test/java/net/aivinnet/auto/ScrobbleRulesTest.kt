package net.aivinnet.auto

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ScrobbleRulesTest {

    @Test
    fun `plays under five seconds are never sent`() {
        assertFalse(ScrobbleRules.shouldSend(ScrobbleRules.seconds(0)))
        assertFalse(ScrobbleRules.shouldSend(ScrobbleRules.seconds(4_999)))
    }

    @Test
    fun `five seconds is the first play that is sent`() {
        assertEquals(5, ScrobbleRules.seconds(5_000))
        assertTrue(ScrobbleRules.shouldSend(ScrobbleRules.seconds(5_000)))
    }

    @Test
    fun `seconds are whole and rounded down`() {
        assertEquals(12, ScrobbleRules.seconds(12_999))
        assertEquals(0, ScrobbleRules.seconds(-40))
    }
}

class ListeningTimerTest {

    @Test
    fun `counts only the time spent playing`() {
        val timer = ListeningTimer()
        timer.onPlaying(0)
        timer.onNotPlaying(3_000) // paused after 3 s
        timer.onPlaying(10_000)
        timer.onNotPlaying(12_000) // 2 s more

        assertEquals(5_000L, timer.listenedMs(20_000))
    }

    @Test
    fun `a running stretch is counted up to now without stopping`() {
        val timer = ListeningTimer()
        timer.onPlaying(1_000)

        assertEquals(4_000L, timer.listenedMs(5_000))
        assertEquals(4_000L, timer.listenedMs(5_000))
    }

    @Test
    fun `repeated playing signals do not restart the clock`() {
        val timer = ListeningTimer()
        timer.onPlaying(0)
        timer.onPlaying(4_000)

        assertEquals(6_000L, timer.listenedMs(6_000))
    }

    @Test
    fun `reset clears the accumulated time`() {
        val timer = ListeningTimer()
        timer.onPlaying(0)
        timer.onNotPlaying(9_000)
        timer.reset()

        assertEquals(0L, timer.listenedMs(20_000))
    }

    @Test
    fun `a short play is dropped by the rule even though it was timed`() {
        val timer = ListeningTimer()
        timer.onPlaying(0)
        timer.onNotPlaying(3_200)

        assertFalse(ScrobbleRules.shouldSend(ScrobbleRules.seconds(timer.listenedMs(3_200))))
    }
}
