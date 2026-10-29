import { NotifType } from '@/enums'

import { getPlaylist } from '@/requests/playlists'
import { useToast } from '@/stores/notification'
import { usePlayer } from '@/stores/player'
import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import { playStatic, STATIC_MS } from '@/utils/radioStatic'

import type { Station } from '@/utils/radioDial'

/**
 * The tuner of the Subspace radio (#542). Every change of station goes the way
 * a queue action does: the music fades out, the static plays, the station's
 * playlist is loaded and started through the queue. Started through the queue
 * means the group seam (`ds.intercept`) sees it, and in a group the station
 * change reaches every device.
 */

const FADE_MS = 150
const FADE_STEPS = 5

/** The music's level as the radio last set it. Other code may duck too; the radio restores to 1. */
let level = 1
/** Bumped by every call. A call that finds a newer one has started stops where it stands. */
let token = 0

const wait = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

function setLevel(value: number) {
    level = value
    usePlayer().setDuck(value)
}

async function fadeTo(target: number, mine: number) {
    const from = level
    for (let step = 1; step <= FADE_STEPS; step++) {
        if (mine !== token) return
        setLevel(from + ((target - from) * step) / FADE_STEPS)
        if (step < FADE_STEPS) await wait(FADE_MS / FADE_STEPS)
    }
}

/**
 * The needle is between stations: the music goes quiet, so a static burst
 * (played on each step) never sits on top of it. Also used when the dial is
 * turned without a release yet.
 */
export function muteForTuning() {
    const mine = ++token
    void fadeTo(0, mine)
}

/** The dial came back to the station that is already playing: the music returns. */
export function resumeMusic() {
    const mine = ++token
    void fadeTo(1, mine)
}

/** The static of one step. Throttled inside `playStatic`, so a fast wheel makes a crackle, not a wall. */
export function crackle() {
    playStatic()
}

/**
 * Tune in a station: fade the music out, play the static, then start the
 * station's playlist. A newer call supersedes this one; the last one wins.
 */
export async function tuneStation(station: Station): Promise<void> {
    const mine = ++token

    await fadeTo(0, mine)
    if (mine !== token) return

    playStatic()
    await wait(STATIC_MS)
    if (mine !== token) return

    const data = await getPlaylist(station.id, false, 0, -1)
    if (mine !== token) return

    if (!data || data.tracks.length === 0) {
        setLevel(1)
        const message = data ? `${station.name} has no tracks yet` : `Could not tune in ${station.name}`
        useToast().showNotification(message, NotifType.Error)
        return
    }

    const tracklist = useTracklist()
    tracklist.setFromPlaylist(data.info.name, data.info.id, data.tracks)

    // Level back up before the queue starts: the new station is the sound now.
    setLevel(1)
    // Through the queue: `play` hands it to `ds.intercept` when a group is joined.
    useQueue().play(0)
}
