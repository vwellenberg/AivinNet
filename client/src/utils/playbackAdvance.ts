export type RepeatMode = 'all' | 'one' | 'none'

/**
 * Does reaching the end of the queue stop playback?
 *
 * Only `repeat: 'none'` ever stops — but "the end of the queue" is a sequential
 * idea, and permanent shuffle does not walk the queue: it jumps around it. So
 * with shuffle on there is no end to reach and playback keeps rolling the dice
 * (the decision on #323). Otherwise a random pick that happened to land on the
 * LAST index stopped playback mid-shuffle, roughly once per queue length.
 *
 * The exception is a queue with nothing to jump to: on a single track "keep
 * rolling" would silently become repeat-one, so that still stops.
 *
 * Both places that decide this must agree — the audio preload arms the gapless
 * switch ahead of time, the `ended` handler catches the case where it never
 * loaded. When they disagreed, one of them stopped the music.
 */
export function stopsAtQueueEnd(repeat: RepeatMode, shuffle: boolean, length: number): boolean {
    if (repeat !== 'none') return false

    return !(shuffle && length > 1)
}
