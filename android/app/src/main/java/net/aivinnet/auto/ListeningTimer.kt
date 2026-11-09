package net.aivinnet.auto

import kotlin.math.max

/**
 * Adds up the time a track was actually playing. Pauses don't count; the clock is passed in,
 * so the rule can be tested without Android.
 */
class ListeningTimer {

    private var playingSince: Long? = null
    private var accumulatedMs: Long = 0L

    fun onPlaying(nowMs: Long) {
        if (playingSince == null) playingSince = nowMs
    }

    fun onNotPlaying(nowMs: Long) {
        playingSince?.let { accumulatedMs += max(0L, nowMs - it) }
        playingSince = null
    }

    fun listenedMs(nowMs: Long): Long =
        accumulatedMs + (playingSince?.let { max(0L, nowMs - it) } ?: 0L)

    fun reset() {
        playingSince = null
        accumulatedMs = 0L
    }
}

/** The scrobble rule. The server rejects plays under 5 s with 400, so those are never sent. */
object ScrobbleRules {
    const val MIN_SECONDS = 5

    /** Whole seconds, rounded down: a play counts only once it really reached 5 s. */
    fun seconds(listenedMs: Long): Int = (max(0L, listenedMs) / 1000L).toInt()

    fun shouldSend(seconds: Int): Boolean = seconds >= MIN_SECONDS
}
