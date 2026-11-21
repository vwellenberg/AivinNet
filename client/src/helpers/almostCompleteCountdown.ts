import { watch, type WatchStopHandle } from 'vue'

/**
 * "Almost complete" counts down as a missing song STARTS, wherever it was
 * started from (the card's play button, "Play the rest", the album page): a
 * card with "2 to go" shows "1 to go" while the first of them plays, and goes
 * when its last one starts (reported: it went at once on the card's button,
 * "2 to go" included, or only when the NEXT card was played).
 *
 * The play itself still counts only once it is logged (the tracker, the
 * server's `almost_complete_played`); this is what Home shows meanwhile.
 * Kept out of the home store: it would have to import the queue, and the queue
 * reaches the player and the tracker, which import the home store.
 */
export function countDownOnStart(
    queue: { playing: boolean; currenttrackhash: string },
    noteStarted: (trackhash: string) => void
): WatchStopHandle {
    // Resuming the same song fires again; taking a song out twice changes nothing.
    return watch(
        () => (queue.playing ? queue.currenttrackhash : ''),
        trackhash => {
            if (trackhash) noteStarted(trackhash)
        },
        { immediate: true }
    )
}
