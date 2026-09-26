// Multiroom device-sync store (client side of the "group session" feature).
//
// Server is the source of truth. This store short-polls the session, feeds a
// Cristian clock-offset estimator and mirrors the authoritative group state
// under a re-entrancy guard (`applying`).
//
// Transport mutations are scheduled by the server LEAD_MS into the future, so
// the state describing one arrives AHEAD of its time. It is held (`pending`),
// its audio prepared on the standby element, and committed at its anchor time
// — on every device at the same instant. While playing, a 250 ms loop steers
// residual drift via playbackRate and compensated seeks, and learns this
// device's start and seek latency from the result (utils/deviceSync/latency.ts).
// The leader books each next track for the exact end of the current one.
//
// Module-level singletons live OUTSIDE the reactive state (same pattern as
// player.ts's `audioSource`): timers, the estimator and the executed-command
// dedupe set must not be proxied by Vue reactivity.

import { defineStore } from 'pinia'

import { clampOffset, loadAudioOffset, saveAudioOffset } from '@/utils/deviceSync/audioOffset'
import { computeCorrection, SEEK_MS } from '@/utils/deviceSync/driftSteer'
import { ClockOffsetEstimator } from '@/utils/deviceSync/clockSync'
import { detectDeviceName, detectDeviceType, getOrCreateDeviceId } from '@/utils/deviceSync/deviceId'
import { expectedPositionMs } from '@/utils/deviceSync/expectedPosition'
import { learnLatency, loadLatency, saveLatency, type LatencyKind } from '@/utils/deviceSync/latency'
import { resolveQueueMove } from '@/utils/queueMove'
import { pickShuffleIndex } from '@/utils/shufflePicker'
import { shiftAfterRemove } from '@/utils/shuffleIndexes'
import type {
    DeviceSummary,
    PollResponse,
    SyncAnchor,
    SyncCommand,
    SyncCommandType,
    SyncFrom,
    SyncState,
} from '@/utils/deviceSync/types'

import {
    joinGroup,
    leaveGroup,
    pollSession,
    registerDevice,
    resolveTracks,
    sendCommand,
    setQueue,
} from '@/requests/devicesync'

import type { Track } from '@/interfaces'
import { NotifType, useToast } from '@/stores/notification'
import { audioSource, usePlayer } from '@/stores/player'
import useQueue from '@/stores/queue'
import type { From } from '@/stores/queue/tracklist'
import useTracklist, { shuffleArray } from '@/stores/queue/tracklist'
import useSettings from '@/stores/settings'

type RepeatMode = 'all' | 'one' | 'none'

/** Poll cadence: fast while in a group, relaxed while solo. */
const CADENCE_JOINED_MS = 1000
const CADENCE_SOLO_MS = 5000
/** Steering tick while playing in a group. */
const STEER_MS = 250
/** Consecutive poll failures before we surface "reconnecting". */
const RECONNECT_AFTER = 3
/** Consecutive poll failures (≈15 s at 1 s cadence) before we dissolve to solo. */
const FAILURES_TO_SOLO = 15
/** Cap on the executed-command dedupe set (FIFO-trimmed). */
const MAX_EXECUTED_IDS = 500
/** Transport commands; the state carries them, see `handleCommands`. */
const TRANSPORT_TYPES = new Set<SyncCommandType>(['play', 'pause', 'seek', 'track_change', 'set_repeat'])

/**
 * How long an action's audible result settles before it is measured (ms).
 * Long enough for three readings past the stall (see SETTLED_READING_MS):
 * one reading is not a measurement on Firefox, whose currentTime jitters.
 */
const SETTLE_MS = 1000
/** Stop waiting for a stalled element (buffering) to settle after this (ms). */
const SETTLE_GIVEUP_MS = 6000
/** A jump smaller than this (ms) is no jump: the playing element carries on. */
const JUMP_MS = 60
/**
 * A prepared (or paused) element this far off where it should start (ms) is
 * re-positioned before it plays; anything less is left to the landing seek.
 * Re-positioning costs a re-buffer of its own, and at 20 ms every slightly
 * late timer paid one.
 */
const RESTART_SLACK_MS = 250
/** A paused element this far off the anchor (ms) is re-positioned — free, nothing sounds. */
const PAUSED_SLACK_MS = 40
/**
 * A transition that landed further off than this (ms) gets one compensated
 * seek right away. Steering 60 ms out by rate took three seconds on a device
 * that had not measured its start latency yet; right after a cut, one more
 * small seek is not heard as a separate event.
 */
const LANDING_SEEK_MS = 35
/** Readings this long after an action are past its stall and count for its landing (ms). */
const SETTLED_READING_MS = 400
/** Readings the steerer takes the median of — Firefox's currentTime jitters by ±40 ms. */
const READINGS = 3
/** The leader books the next track this long before the current one ends (ms)... */
const BOOK_AHEAD_MS = 4000
/** ...but no later than this before the end; `ended` handles anything shorter. */
const BOOK_MIN_MS = 400

// --- non-reactive module singletons -----------------------------------------

let estimator = new ClockOffsetEstimator()
const executedCommandIds = new Set<string>()

let pollTimer: any = null
let pollingActive = false
let steerTimer: any = null
let visibilityHandler: (() => void) | null = null

/**
 * Polls are numbered; a response older than one already applied is dropped.
 * Two polls can be in flight (the loop, a visibility refocus, the immediate
 * poll after a command), and a stale state landing last would roll the group
 * back — or a solo response from just before a join would dissolve it again.
 */
let pollSeq = 0
let appliedSeq = 0

/**
 * The next group state, received ahead of its time.
 *
 * Applying it on receipt made every device act at its own poll phase: a track
 * change started up to 1.5 s early and then restarted on the scheduled
 * command, a seek ran twice, a pause stopped each device at a different
 * moment — measured with two browsers on one clock (~/syncprobe on the server).
 */
interface Pending {
    state: SyncState
    /** The resolved list when the queue changes with this state, else null. */
    tracks: Track[] | null
    /** What the standby element was prepared for; '' = the playing element carries it. */
    key: string
    handle: any
}
let pending: Pending | null = null

function clearPending() {
    if (pending) clearTimeout(pending.handle)
    pending = null
}

/**
 * The last action whose audible result is still settling. Steering holds off
 * until it has, then measures the residual error and learns from it. Seeking
 * again before a seek had landed is what produced ten seeks in a row.
 */
let settle: { kind: LatencyKind | 'load'; at: number; lead: number } | null = null
/** Rate steering is engaged (hysteresis, see driftSteer.ts). */
let steering = false
/** The last few error readings since the clock last jumped; decisions use their median. */
let readings: { at: number; error: number }[] = []

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b)
    const mid = sorted.length >> 1
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}
let latency = loadLatency()

/** The anchor the leader already booked the next track for — one booking per anchor. */
let bookedFor = ''

/**
 * Nesting depth of `withApplying` sections. A plain boolean would let an inner
 * section (e.g. a pending state committing during a mirror) clear the outer
 * section's flag prematurely.
 */
let applyDepth = 0

/**
 * The join sequence currently running, or null. `leave()` waits on it instead
 * of bailing out: the invite overlay's "Not now" fires exactly while the join
 * is still calibrating, and a leave dropped there would leave the device in
 * the group it just declined.
 */
let joinInFlight: Promise<void> | null = null

/**
 * While set (epoch ms deadline), poll() must NOT re-adopt a server-side
 * membership: the user just pressed Leave and the server may not have
 * processed it yet — without this, an in-flight poll bounces the device
 * straight back into the group it left.
 */
let leaveSuppressUntil = 0

/**
 * Auto-rejoin: a device that dropped out involuntarily (app closed longer than
 * the reap window, network gap, server restart) rejoins a STILL-RUNNING group
 * on its own. The marker survives reloads in localStorage; it is cleared only
 * on a deliberate exit (Leave, "Not now", being removed), never by toSolo().
 *
 * Hard rule: this may only ever join an existing group — it must never create
 * one, or opening the app on a phone would start a group nobody asked for.
 */
const GROUP_MEMBER_KEY = 'aivinnet.group_member'
/** Backoff after an auto-rejoin attempt, so a failing one cannot loop. */
const AUTO_REJOIN_COOLDOWN_MS = 60000
let autoRejoinSuppressUntil = 0

function rememberMembership(isMember: boolean) {
    try {
        if (isMember) localStorage.setItem(GROUP_MEMBER_KEY, '1')
        else localStorage.removeItem(GROUP_MEMBER_KEY)
    } catch {
        // storage unavailable (private mode) — auto-rejoin simply stays off
    }
}

function wasGroupMember(): boolean {
    try {
        return localStorage.getItem(GROUP_MEMBER_KEY) === '1'
    } catch {
        return false
    }
}

/**
 * TEST-ONLY: reset every module-level singleton. `vi.resetModules()` is not
 * reliable here (it can hand the re-imported store a different pinia module
 * copy, silently reusing the previous test's store state), so the test suite
 * imports the store statically and calls this in beforeEach instead.
 */
export function __resetDeviceSyncTestState() {
    clearPending()
    executedCommandIds.clear()
    estimator = new ClockOffsetEstimator()
    leaveSuppressUntil = 0
    autoRejoinSuppressUntil = 0
    applyDepth = 0
    joinInFlight = null
    loadedTrackhash = ''
    appliedRate = 1
    settle = null
    steering = false
    readings = []
    latency = loadLatency()
    bookedFor = ''
    pollSeq = 0
    appliedSeq = 0
    pollingActive = false
    if (pollTimer) {
        clearTimeout(pollTimer)
        pollTimer = null
    }
    if (steerTimer) {
        clearInterval(steerTimer)
        steerTimer = null
    }
    if (visibilityHandler && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', visibilityHandler)
        visibilityHandler = null
    }
}

/** TEST-ONLY: this device's current latency estimates. */
export function __latencyForTest() {
    return { ...latency }
}

// The trackhash currently loaded into the audio element and the last applied
// playbackRate — both tracked here (not in reactive state) so reconciliation
// and steering can compare cheaply without reading the media element.
let loadedTrackhash = ''
let appliedRate = 1

function rememberCommandId(id: string) {
    executedCommandIds.add(id)
    if (executedCommandIds.size <= MAX_EXECUTED_IDS) return

    // FIFO trim: a Set preserves insertion order, so the oldest ids come first.
    const excess = executedCommandIds.size - MAX_EXECUTED_IDS
    let removed = 0
    for (const key of executedCommandIds) {
        executedCommandIds.delete(key)
        if (++removed >= excess) break
    }
}

/** Reset drift steering to neutral rate — keeps `appliedRate` and the element in lockstep. */
function resetRate(player: ReturnType<typeof usePlayer>) {
    player.setPlaybackRate(1)
    appliedRate = 1
    steering = false
}

/**
 * Open a settle window for an action taken just now — earlier readings are
 * void. `leadMs`: how far ahead of the anchor the element was placed (see
 * `learnLatency`); irrelevant for a load, whose delay is the network's.
 */
function settleAfter(kind: LatencyKind | 'load', leadMs = 0) {
    settle = { kind, at: Date.now(), lead: leadMs }
    readings = []
}

export default defineStore('devicesync', {
    state: () => ({
        deviceId: '',
        deviceName: '',
        deviceType: '',
        registered: false,
        joined: false,
        /** Re-entrancy guard: true while mirroring server state, so seams don't echo. */
        applying: false,
        sessionVersion: 0,
        queueId: '',
        /** trackhashes joined with '\n' — a cheap queue-identity key (no sha1). */
        lastMirroredHashKey: '',
        devices: [] as DeviceSummary[],
        scrobbleLeader: null as string | null,
        /** The anchor in effect NOW (a pending one takes over at its time). */
        anchor: null as SyncAnchor | null,
        /** Server truth for whether the session is playing (in effect now). */
        playing: false,
        status: 'solo' as 'solo' | 'joined' | 'reconnecting',
        /** Autoplay-block overlay flag — consumed by the later UI PR. */
        needsGesture: false,
        /**
         * A membership transition that is still in flight, or null.
         *
         * Joining takes a round trip plus a clock calibration burst (~1 s), and
         * leaving takes a round trip — while neither the device list nor
         * `joined` has moved yet. Without this the picker looked completely
         * dead after the tap and invited a second one, which fired a second
         * join/leave at the server. The UI names the pending action and blocks
         * its button; every entry point (picker, invite, auto-rejoin) goes
         * through the same guard.
         */
        membershipPending: null as null | 'join' | 'leave',
        /**
         * Manual trim for this device's output latency (Bluetooth speakers,
         * TVs). Positive = run ahead of the group anchor. Persisted locally,
         * never shared: it describes hardware, not the session.
         */
        audioOffsetMs: loadAudioOffset(),
        pollFailures: 0,
    }),

    getters: {
        isScrobbleLeader(state): boolean {
            return !!state.deviceId && state.scrobbleLeader === state.deviceId
        },
        me(state): DeviceSummary | undefined {
            return state.devices.find(d => d.device_id === state.deviceId)
        },
        others(state): DeviceSummary[] {
            return state.devices.filter(d => d.device_id !== state.deviceId)
        },
    },

    actions: {
        // --- identity / registration ----------------------------------------
        async register() {
            this.deviceId = getOrCreateDeviceId()
            this.deviceName = detectDeviceName()
            this.deviceType = detectDeviceType()
            await registerDevice(this.deviceId, this.deviceName, this.deviceType)
            this.registered = true
        },

        // --- poll loop ------------------------------------------------------
        startPolling() {
            if (pollingActive) return
            pollingActive = true
            this.ensureVisibilityListener()
            this.scheduleNextPoll()
        },
        stopPolling() {
            pollingActive = false
            if (pollTimer) {
                clearTimeout(pollTimer)
                pollTimer = null
            }
            this.removeVisibilityListener()
        },
        scheduleNextPoll() {
            if (!pollingActive) return
            // Idempotent: cancel any pending timer first. A cadence restart
            // during an in-flight poll would otherwise race the poll's own
            // trailing reschedule and leave TWO poll loops running.
            if (pollTimer) {
                clearTimeout(pollTimer)
                pollTimer = null
            }
            const cadence = this.joined ? CADENCE_JOINED_MS : CADENCE_SOLO_MS
            pollTimer = setTimeout(() => {
                void this.poll().finally(() => this.scheduleNextPoll())
            }, cadence)
        },
        /** Re-arm the next poll immediately so a joined/solo change takes effect at once. */
        restartPollingCadence() {
            if (!pollingActive) return
            if (pollTimer) {
                clearTimeout(pollTimer)
                pollTimer = null
            }
            this.scheduleNextPoll()
        },
        ensureVisibilityListener() {
            if (visibilityHandler || typeof document === 'undefined') return
            visibilityHandler = () => {
                if (document.visibilityState === 'visible') {
                    void this.poll()
                    this.hardResync()
                }
            }
            document.addEventListener('visibilitychange', visibilityHandler)
        },
        removeVisibilityListener() {
            if (!visibilityHandler || typeof document === 'undefined') return
            document.removeEventListener('visibilitychange', visibilityHandler)
            visibilityHandler = null
        },

        async poll() {
            if (!this.deviceId) return
            const settings = useSettings()
            const seq = ++pollSeq
            const t0 = Date.now()

            let res: PollResponse | null = null
            try {
                res = await pollSession({
                    device_id: this.deviceId,
                    known_version: this.sessionVersion,
                    client_sent_ms: t0,
                    volume: settings.volume,
                    mute: settings.mute,
                })
            } catch {
                // network/parse failure — treated the same as a null response below.
                res = null
            }

            // A newer poll (or a join) has already been applied: this answer is stale.
            if (seq < appliedSeq) return

            if (!res) {
                this.pollFailures++
                if (this.pollFailures >= RECONNECT_AFTER) {
                    this.status = 'reconnecting'
                }
                if (this.joined && this.pollFailures >= FAILURES_TO_SOLO) {
                    // ≈15 s of silence while joined → dissolve to solo, keep playing.
                    this.toSolo()
                }
                return
            }
            appliedSeq = seq

            estimator.addSample(t0, res.server_now_ms, Date.now())
            this.pollFailures = 0
            if (this.status === 'reconnecting') {
                this.status = this.joined ? 'joined' : 'solo'
            }
            this.devices = res.devices ?? []
            this.scrobbleLeader = res.scrobble_leader ?? null

            // Membership transitions — the server is authoritative BOTH ways:
            // it no longer considers us joined (e.g. it restarted and the RAM
            // session is gone) → graceful solo; it still considers us a member
            // while our local state is fresh (page reload mid-session) →
            // re-adopt the membership.
            if (this.joined && !res.joined) {
                this.toSolo()
                this.sessionVersion = res.version
                return
            }
            if (!res.joined) {
                leaveSuppressUntil = 0
            }

            // Auto-rejoin: we are outside the group, we used to be in one, and
            // one is STILL running → walk back in. Never fires when no group
            // exists (would create one) or right after a deliberate exit.
            if (!res.joined && !this.joined && wasGroupMember()) {
                const groupRunning = (res.devices ?? []).some(d => d.joined)
                const now = Date.now()
                if (groupRunning && now > autoRejoinSuppressUntil && now > leaveSuppressUntil) {
                    autoRejoinSuppressUntil = now + AUTO_REJOIN_COOLDOWN_MS
                    void this.joinInternal()
                    return
                }
            }
            let forceStateRefresh = false
            if (res.joined && !this.joined) {
                if (Date.now() < leaveSuppressUntil) {
                    // The user just left; the server hasn't caught up yet.
                    return
                }
                this.joined = true
                this.status = 'joined'
                loadedTrackhash = usePlayer().loadedTrackhash()
                this.startSteerLoop()
                // Force a full re-mirror: the local list may have diverged
                // while we were solo (queue_id alone would not notice).
                this.queueId = ''
                this.lastMirroredHashKey = ''
                // No state in this response → request it on the next poll
                // (but still process this response's commands below).
                if (!res.state) forceStateRefresh = true
            }

            // The server sends `state` to EVERY device of the user (also
            // non-members). Only members may mirror it — a solo device must
            // never have the group queue clobber its local playback.
            let applied = true
            if (res.joined && res.state) {
                applied = await this.applyState(res.state)
            }
            this.handleCommands(res.commands ?? [])
            if (forceStateRefresh) {
                this.sessionVersion = 0
            } else if (applied) {
                // On a failed state apply keep known_version stale so the
                // server re-sends the state on the next poll.
                this.sessionVersion = res.version
            }
        },

        /** Poll right away — after sending a command, to hear its state as early as possible. */
        pollSoon() {
            if (this.joined) void this.poll()
        },

        /**
         * Run `fn` under the mirror re-entrancy guard. `fn` MUST be synchronous:
         * the guard must never span an await, or genuine user actions during
         * the async window would bypass the transport seams unbroadcast.
         */
        withApplying(fn: () => void) {
            applyDepth++
            this.applying = true
            try {
                fn()
            } finally {
                applyDepth--
                if (applyDepth === 0) this.applying = false
            }
        },

        /** Re-derive transport from the current anchor (used on tab re-focus). */
        hardResync() {
            if (!this.joined || !this.anchor) return
            this.withApplying(() => this.alignTransport())
        },

        // --- authoritative state mirroring ----------------------------------

        /**
         * Take in a group state: commit it now if its anchor time has come,
         * otherwise hold it until then (see `Pending`). Returns false when the
         * queue could not be resolved, so the caller keeps known_version stale.
         */
        async applyState(state: SyncState): Promise<boolean> {
            // Queue identity = the server-computed queue_id (sha1 of hashes) —
            // no O(N) key building on the unchanged hot path.
            const queueChanged = state.queue_id !== this.queueId

            let tracks: Track[] | null = null
            if (queueChanged) {
                // Resolve OUTSIDE the applying guard (must not span an await).
                tracks =
                    pending?.tracks && pending.state.queue_id === state.queue_id
                        ? pending.tracks
                        : await resolveTracks(state.trackhashes)
                if (tracks.length === 0 && state.trackhashes.length > 0) {
                    // Resolve failed — keep the old mirror; queueId stays stale
                    // so the next poll retries.
                    return false
                }
            }

            // Superseded by this state, whether it takes over now or later.
            clearPending()

            if (state.anchor.at_server_ms > estimator.serverNow()) {
                this.holdUntilDue(state, tracks)
            } else {
                this.commit(state, tracks)
            }
            return true
        },

        /** Hold a future state, prepare its audio, and commit it on its anchor time. */
        holdUntilDue(state: SyncState, tracks: Track[] | null) {
            // Repeat changes nothing that sounds — mirror it now. Direct write,
            // not toggleRepeatMode(): mirroring must not re-broadcast.
            this.withApplying(() => {
                useSettings().repeat = state.repeat as RepeatMode
            })

            const target = (tracks ?? useTracklist().tracklist)[state.currentindex]
            const key = this.prepareStandbyFor(state, target)

            // Starting sound takes this device `latency.start` ms — begin that
            // much early, so it is audible exactly on the anchor.
            const startsSound = state.playing && (!this.playing || key !== '')
            const lead = startsSound ? latency.start : 0
            const dueLocalMs = state.anchor.at_server_ms - estimator.offset - lead

            const entry: Pending = { state, tracks, key, handle: null }
            entry.handle = setTimeout(
                () => {
                    if (pending !== entry) return
                    pending = null
                    this.commit(state, tracks, key)
                },
                Math.max(0, dueLocalMs - Date.now())
            )
            pending = entry
        },

        /**
         * Load the target of a transition that JUMPS — another track, or this
         * one at another position — onto the standby element, positioned and
         * paused. Returns the preparation key, or '' when the playing element
         * carries the transition itself (a pause, a resume in place).
         */
        prepareStandbyFor(state: SyncState, target: Track | undefined): string {
            if (!target?.filepath || !this.joined) return ''

            const startMs = Math.max(0, state.anchor.position_ms + this.audioOffsetMs)
            if (target.trackhash === loadedTrackhash) {
                if (!state.playing) return ''
                // Where the playing element will be by then if nothing happens.
                const willBeAt =
                    this.playing && this.anchor
                        ? expectedPositionMs(this.anchor, state.anchor.at_server_ms, true) + this.audioOffsetMs
                        : usePlayer().getCurrentTimeMs()
                if (Math.abs(willBeAt - startMs) < JUMP_MS) return ''
            }

            const key = `${target.trackhash}@${startMs}@${state.anchor.at_server_ms}`
            usePlayer().prepareGroupStandby(target, startMs, key)
            return key
        },

        /** Make `state` the one in effect: mirror queue, index and flags, then align the audio. */
        commit(state: SyncState, tracks: Track[] | null, key = '') {
            this.withApplying(() => {
                if (tracks) {
                    const tracklist = useTracklist()
                    tracklist.setNewList(tracks)
                    tracklist.from = state.from as From
                    this.lastMirroredHashKey = state.trackhashes.join('\n')
                    this.queueId = state.queue_id
                }

                const queue = useQueue()
                // A mirrored index move IS a track change for this device, so the
                // shuffle target has to be rolled again — otherwise it still points
                // at the track that just started. Only on an actual change: the
                // poll runs every second and re-rolling on every tick would make
                // `nextindex` a moving target.
                const indexMoved = queue.currentindex !== state.currentindex
                queue.currentindex = state.currentindex
                if (indexMoved) queue.rollShuffleNext()

                // Direct state write, not toggleRepeatMode() — mirroring must not
                // re-broadcast as a set_repeat command.
                useSettings().repeat = state.repeat as RepeatMode

                this.anchor = state.anchor
                this.playing = state.playing

                this.alignTransport(key)
            })
        },

        /**
         * Bring this device's audio onto the group state in effect.
         *
         * `key` names a standby prepared for exactly this transition — switching
         * to it is instant. Without one the playing element is used: a new track
         * is loaded now (join, catch-up after a missed transition), the same
         * track is paused, resumed or re-positioned. Every path that moves the
         * clock opens a settle window for the steerer.
         */
        alignTransport(key = '') {
            if (!this.anchor) return

            const queue = useQueue()
            const tracklist = useTracklist()
            const player = usePlayer()

            const current = tracklist.tracklist[queue.currentindex]
            if (!current || !current.filepath) {
                // An EMPTY group queue is not a resolve gap — it means the group
                // has nothing to play (someone cleared it, or removed the last
                // track), so stop. Without this the element keeps playing the
                // now-orphaned track while the steerer hammers it back to the
                // zero anchor every 250 ms.
                if (tracklist.tracklist.length === 0) {
                    queue.playing = false
                    audioSource.pausePlayingSource()
                    resetRate(player)
                    loadedTrackhash = ''
                    settle = null
                }
                // Missing-track gap: fewer tracks resolved than hashes and the
                // current one is absent → stay paused-mirroring, do not crash.
                return
            }

            queue.playing = this.playing

            // 1. A prepared standby: cut over. When this starts sound it runs
            //    `latency.start` early (holdUntilDue), so "where the anchor will
            //    be once it sounds" is the prepared position itself. A commit
            //    that came far too late (a throttled timer) is moved on first —
            //    that start re-buffers, so it teaches nothing about the device.
            if (key && player.groupStandbyReady(key)) {
                let startsAt = player.groupStandbyTimeMs()
                let clean = true
                if (this.playing) {
                    const soundsAt = this.expectedMs(latency.start)
                    if (Math.abs(startsAt - soundsAt) > RESTART_SLACK_MS) {
                        player.seekGroupStandbyMs(soundsAt)
                        startsAt = soundsAt
                        clean = false
                    }
                }
                resetRate(player)
                player.switchToGroupStandby(current, this.playing, loadedTrackhash !== current.trackhash)
                loadedTrackhash = current.trackhash
                if (this.playing) settleAfter(clean ? 'start' : 'load', this.leadOf(startsAt))
                else settle = null
                return
            }

            // 2. Another track and nothing prepared: load it on the playing element.
            if (loadedTrackhash !== current.trackhash) {
                resetRate(player)
                player.playCurrent()
                loadedTrackhash = current.trackhash
                // Default start position; once it plays, the steerer lands it
                // (its load time is unknown, so there is nothing to learn here).
                player.hardSeekMs(this.expectedMs())
                if (this.playing) settleAfter('load')
                else settle = null
                return
            }

            // 3. Same track, paused: position it exactly — free while silent.
            if (!this.playing) {
                audioSource.pausePlayingSource()
                resetRate(player)
                player.hardSeekMs(this.expectedMs())
                settle = null
                return
            }

            // 4. Same track, resume: it sits where it paused, which is where the
            //    anchor will be once it sounds when this runs on time. Far off
            //    (a late tap on the autoplay prompt) it is moved there first.
            if (player.isPaused()) {
                const soundsAt = this.expectedMs(latency.start)
                let startsAt = player.getCurrentTimeMs()
                const clean = Math.abs(startsAt - soundsAt) <= RESTART_SLACK_MS
                if (!clean) {
                    player.hardSeekMs(soundsAt)
                    startsAt = soundsAt
                }
                resetRate(player)
                void audioSource.playPlayingSource()
                settleAfter(clean ? 'start' : 'load', this.leadOf(startsAt))
                return
            }

            // 5. Same track, playing: only a real offset needs a (compensated)
            //    seek — judged on one reading here, so only beyond what the
            //    steerer would seek for anyway (Firefox jitters by ±40 ms).
            if (Math.abs(player.getCurrentTimeMs() - this.expectedMs()) > SEEK_MS) this.seekCompensated()
        },

        /** Seek the playing element to where the anchor will be once the seek has landed. */
        seekCompensated() {
            const player = usePlayer()
            resetRate(player)
            const target = this.expectedMs(latency.seek)
            player.hardSeekMs(target)
            settleAfter('seek', this.leadOf(target))
        },

        /**
         * How many ms from now the anchor reaches `positionMs` (incl. this
         * device's trim) — how far AHEAD of the group an element sitting there
         * is. Unclamped, unlike `expectedMs`: a track start is ahead of an
         * anchor that has not begun yet, and that difference is the lead a
         * latency is learned against.
         */
        leadOf(positionMs: number): number {
            if (!this.anchor) return 0
            const { position_ms, at_server_ms } = this.anchor
            return at_server_ms + (positionMs - this.audioOffsetMs - position_ms) - estimator.serverNow()
        },

        /** Expected position (ms, incl. this device's trim) `aheadMs` from now. */
        expectedMs(aheadMs = 0): number {
            if (!this.anchor) return 0
            return (
                expectedPositionMs(this.anchor, estimator.serverNow() + aheadMs, this.playing) + this.audioOffsetMs
            )
        },

        // --- command handling -----------------------------------------------

        /**
         * Only TARGETED commands are executed here. Transport commands are
         * carried by the state: the same poll that delivers one delivers the
         * version bump with its anchor, and that state is what gets committed
         * at the anchor time. Executing both is exactly how every seek used to
         * run twice.
         */
        handleCommands(cmds: SyncCommand[]) {
            for (const cmd of cmds) {
                if (executedCommandIds.has(cmd.id)) continue
                // Add before executing: the server re-delivers pending commands
                // during a grace window, so dedupe strictly by id.
                rememberCommandId(cmd.id)

                if (cmd.target_device !== null && cmd.target_device !== undefined) {
                    if (cmd.target_device !== this.deviceId) continue
                    this.handleTargeted(cmd)
                } else if (!TRANSPORT_TYPES.has(cmd.type)) {
                    console.warn(`[devicesync] ignoring unknown group command ${cmd.type}`)
                }
            }
        },

        /** Targeted (execute_at 0) commands addressed to this device. */
        handleTargeted(cmd: SyncCommand) {
            const p = (cmd.payload ?? {}) as any

            switch (cmd.type) {
                case 'set_volume': {
                    this.withApplying(() => useSettings().setVolume(p.volume))
                    break
                }
                case 'set_mute': {
                    this.withApplying(() => {
                        const settings = useSettings()
                        settings.mute = !!p.mute
                        usePlayer().setMute(settings.mute)
                    })
                    break
                }
                case 'join_invite': {
                    void this.joinNow()
                    break
                }
                case 'play_here': {
                    // Another device pressed "play here only": recipients bow out
                    // of the group and stop their audio.
                    this.playHereLeave()
                    break
                }
                default:
                    break
            }
        },

        // --- drift steering --------------------------------------------------
        startSteerLoop() {
            if (steerTimer) return
            steerTimer = setInterval(() => this.steerTick(), STEER_MS)
        },
        stopSteerLoop() {
            if (!steerTimer) return
            clearInterval(steerTimer)
            steerTimer = null
        },
        steerTick() {
            // needsGesture: audio is autoplay-blocked — steering would seek a
            // frozen element every tick for nothing.
            if (!this.joined || !this.anchor || this.applying || this.needsGesture) return

            this.bookNextTrack()

            const player = usePlayer()
            const error = player.getCurrentTimeMs() - this.expectedMs()

            if (!this.playing) {
                // Paused: recover a lost position — e.g. the element was still
                // loading when it was positioned, so it silently reset to 0.
                if (Math.abs(error) > PAUSED_SLACK_MS) player.hardSeekMs(this.expectedMs())
                return
            }

            const now = Date.now()
            const advancing = player.isAdvancing()
            if (advancing) {
                readings.push({ at: now, error })
                if (readings.length > READINGS) readings.shift()
            }

            if (settle) {
                const since = settle.at
                const age = now - since
                if (age < SETTLE_MS || !advancing) {
                    if (age > SETTLE_GIVEUP_MS) settle = null
                    return
                }
                const { kind: landed, lead } = settle
                const residual = median(readings.filter(r => r.at - since >= SETTLED_READING_MS).map(r => r.error))
                settle = null
                if (landed !== 'load') {
                    latency = { ...latency, [landed]: learnLatency(latency[landed], lead, residual) }
                    saveLatency(latency)
                }
                // The landing of a transition itself (not of a correction):
                // one seek now beats seconds of rate steering.
                if (landed !== 'seek' && Math.abs(residual) > LANDING_SEEK_MS) {
                    this.seekCompensated()
                    return
                }
            }

            // Buffering, ended, or blocked: a seek would only restart the wait.
            if (!advancing) return

            const correction = computeCorrection(median(readings.map(r => r.error)), steering)
            if (correction.action === 'seek') {
                this.seekCompensated()
            } else if (correction.action === 'rate') {
                steering = true
                player.setPlaybackRate(correction.rate)
                appliedRate = correction.rate
            } else if (appliedRate !== 1 || steering) {
                resetRate(player)
            }
        },

        /**
         * Burst a few polls to pin down the clock offset.
         *
         * The estimator keeps the lowest-RTT sample, and right after joining it
         * has exactly one — if that single sample was a slow one, playback
         * starts measurably offset and only creeps into place. A short burst
         * makes the starting estimate as good as a steady-state one.
         */
        async calibrateClock(rounds = 4) {
            if (!this.deviceId) return
            for (let i = 0; i < rounds; i++) {
                const t0 = Date.now()
                const res = await pollSession({
                    device_id: this.deviceId,
                    known_version: this.sessionVersion,
                    client_sent_ms: t0,
                    volume: useSettings().volume,
                    mute: useSettings().mute,
                })
                if (res) estimator.addSample(t0, res.server_now_ms, Date.now())
                if (i < rounds - 1) await new Promise(r => setTimeout(r, 120))
            }
        },

        // --- membership transitions -----------------------------------------

        /**
         * Every join goes through here: the picker, an accepted invite and the
         * auto-rejoin from poll(). The guard is what makes the button-blocking
         * in the picker honest — a second join while the first one is still
         * calibrating would register twice and race two snapshots into the
         * queue mirror.
         */
        async joinInternal() {
            if (!this.deviceId || this.membershipPending) return
            this.membershipPending = 'join'
            joinInFlight = this.runJoin()
            try {
                await joinInFlight
            } finally {
                joinInFlight = null
                this.membershipPending = null
            }
        },

        /** The join sequence itself — call `joinInternal`, never this. */
        async runJoin() {
            const t0 = Date.now()
            const res = await joinGroup(this.deviceId)
            // Any poll answered before the join landed speaks for the device
            // as it was — solo. Applying one now would dissolve the fresh
            // membership again.
            appliedSeq = pollSeq + 1
            const snap = res?.data as PollResponse | undefined

            this.joined = true
            this.status = 'joined'
            this.pollFailures = 0
            this.markSelfJoined(true)
            // Remembered across reloads so an involuntary drop-out can rejoin.
            rememberMembership(true)

            // A crossfade/preload timer armed while solo must not fire a local
            // advance into the group session.
            const player = usePlayer()
            player.clearMovingNextTimeout()
            player.clearNextAudio()
            // Whatever solo playback left loaded — the mirror compares against it.
            loadedTrackhash = player.loadedTrackhash()

            const snapState = snap?.state
            const emptySession = !snapState || (snapState.trackhashes?.length ?? 0) === 0

            // Pin the clock down BEFORE the first mirror, so playback does not
            // start on a single noisy offset sample.
            if (snap && typeof snap.server_now_ms === 'number') {
                estimator.addSample(t0, snap.server_now_ms, Date.now())
            }
            await this.calibrateClock()

            if (emptySession && useTracklist().tracklist.length > 0) {
                // First joiner into an empty session seeds it from local state —
                // the song already playing here carries on (live), nobody jumps.
                if (snap?.devices) this.devices = snap.devices
                this.scrobbleLeader = snap?.scrobble_leader ?? null
                if (typeof snap?.version === 'number') this.sessionVersion = snap.version
                await this.sendQueueSet({ live: true })
            } else {
                await this.applySnapshot(snap)
            }

            this.startSteerLoop()
            this.restartPollingCadence()
        },

        /** User-gesture join (device picker). */
        async join() {
            await this.joinInternal()
        },

        /** Remote-invite join: audio play() may be autoplay-blocked → needsGesture. */
        async joinNow() {
            await this.joinInternal()
        },

        /**
         * Set this device's output-latency trim and realign immediately, so the
         * user hears the effect of the slider while dragging it.
         */
        setAudioOffset(ms: number) {
            this.audioOffsetMs = saveAudioOffset(clampOffset(ms))
            if (this.joined && this.anchor) this.hardResync()
        },

        /** Retry the blocked play() from a real user gesture and clear the flag. */
        completeGestureJoin() {
            this.needsGesture = false
            this.withApplying(() => this.alignTransport())
        },

        async applySnapshot(snap: PollResponse | undefined) {
            if (!snap) return
            this.devices = snap.devices ?? this.devices
            this.scrobbleLeader = snap.scrobble_leader ?? null
            const applied = snap.state ? await this.applyState(snap.state) : true
            this.handleCommands(snap.commands ?? [])
            // A failed state apply keeps known_version stale → server re-sends.
            if (applied && typeof snap.version === 'number') this.sessionVersion = snap.version
        },

        /**
         * Flip this device's row in the cached device list right away.
         *
         * That list is server data, refreshed only by the next poll — up to 5 s
         * away once we are solo again. Leaving therefore left the picker
         * showing this device as "In group" long after it had left, which read
         * as "the button did nothing".
         */
        markSelfJoined(joined: boolean) {
            if (!this.deviceId) return
            this.devices = this.devices.map(d => (d.device_id === this.deviceId ? { ...d, joined } : d))
        },

        /** Voluntary leave: keep playing locally (dissolve-to-solo semantics). */
        async leave() {
            // Let a running join finish first — otherwise it lands right after
            // us and puts the device back into the group (the invite overlay's
            // "Not now" is exactly that case). A leave already in flight leaves
            // no join behind, so this waits only when there is one.
            if (joinInFlight) await joinInFlight.catch(() => {})
            // Checked AFTER the wait, so a second Leave that queued up behind
            // the same join drops out here instead of sending a second request.
            if (this.membershipPending === 'leave') return
            const id = this.deviceId
            this.membershipPending = 'leave'
            leaveSuppressUntil = Date.now() + 10000
            // Deliberate exit → do not walk back in on the next poll.
            rememberMembership(false)
            this.toSolo()
            try {
                if (id) await leaveGroup(id)
            } finally {
                this.markSelfJoined(false)
                this.membershipPending = null
            }
        },

        /** play_here recipient: leave the group AND stop audio. */
        playHereLeave() {
            const id = this.deviceId
            leaveSuppressUntil = Date.now() + 10000
            // Removed on purpose (by another device) → no auto-rejoin either.
            rememberMembership(false)
            if (id) void leaveGroup(id)
            audioSource.pausePlayingSource()
            useQueue().playing = false
            this.toSolo()
            this.markSelfJoined(false)
        },

        /**
         * Internal graceful fallback to solo — never stops local playback and
         * deliberately KEEPS the membership marker: this is the involuntary
         * path (reaped, network gap, server restart) that auto-rejoin exists
         * for. Deliberate exits clear the marker themselves.
         */
        toSolo() {
            this.joined = false
            this.stopSteerLoop()
            // A held group state must not take over solo playback later.
            clearPending()
            settle = null
            bookedFor = ''
            if (appliedRate !== 1 || steering) resetRate(usePlayer())
            this.status = 'solo'
            this.restartPollingCadence()
        },

        // --- outbound: queue-set + commands ---------------------------------
        async sendQueueSet(opts?: {
            trackhashes?: string[]
            from?: SyncFrom
            currentindex?: number
            playing?: boolean
            position_ms?: number
            repeat?: string
            live?: boolean
        }) {
            const tracklist = useTracklist()
            const queue = useQueue()
            const settings = useSettings()
            const player = usePlayer()

            const res = await setQueue({
                device_id: this.deviceId,
                trackhashes: opts?.trackhashes ?? tracklist.tracklist.map(t => t.trackhash),
                from: opts?.from ?? (tracklist.from as SyncFrom),
                currentindex: opts?.currentindex ?? queue.currentindex,
                playing: opts?.playing ?? queue.playing,
                // Whole milliseconds: the API's position fields are integers.
                position_ms: Math.round(opts?.position_ms ?? player.getCurrentTimeMs()),
                repeat: opts?.repeat ?? settings.repeat,
                live: opts?.live ?? false,
            })

            if (!this.reportSyncFailure(res, 'Could not share the queue with the group')) this.pollSoon()
        },

        async sendCmd(type: SyncCommandType, payload: unknown, target_device?: string, execute_at_ms?: number) {
            const res = await sendCommand({ device_id: this.deviceId, type, payload, target_device, execute_at_ms })
            const failed = this.reportSyncFailure(res, 'Group playback command failed')
            if (failed && execute_at_ms !== undefined) {
                // The booking did not land — let `ended` advance the group instead.
                bookedFor = ''
            }
            if (!failed && TRANSPORT_TYPES.has(type)) this.pollSoon()
        },

        /**
         * Surface a rejected sync call instead of swallowing it; true when it failed.
         *
         * A silently dropped queue-set (422 on a fractional position) is exactly
         * what made group playback look "connected but dead": the UI showed the
         * group as joined while the server had no queue at all.
         */
        reportSyncFailure(res: { status?: number } | undefined, what: string): boolean {
            const status = res?.status
            if (status === undefined || (status >= 200 && status < 300)) return false

            console.error(`[devicesync] ${what} (HTTP ${status})`, res)
            useToast().showNotification(`${what} (HTTP ${status})`, NotifType.Error)
            return true
        },

        /**
         * The index a track change already on its way leads to, or null.
         *
         * Between a Next and its anchor time this device still plays — and
         * shows — the old track, so a second Next must count from the track
         * the group is heading to, or rapid skipping would never get past one.
         */
        upcomingIndex(): number | null {
            if (!pending || pending.tracks) return null
            const index = pending.state.currentindex
            return index !== useQueue().currentindex ? index : null
        },

        /**
         * Where the group is — or is heading, while a transition in this queue
         * is held. A live edit has to carry THAT: sent with the track still
         * sounding here, the server saw a different current track, re-anchored
         * it, and silently undid the Next or Pause pressed a second earlier.
         */
        groupPosition(): { index: number; playing: boolean } {
            if (pending && !pending.tracks) {
                return { index: pending.state.currentindex, playing: pending.state.playing }
            }
            const queue = useQueue()
            return { index: queue.currentindex, playing: queue.playing }
        },

        // --- transport interception (called from queue/settings seams) ------
        intercept(action: string, ...args: any[]) {
            const queue = useQueue()
            const tracklist = useTracklist()
            const settings = useSettings()

            switch (action) {
                case 'play': {
                    const index = typeof args[0] === 'number' ? args[0] : 0
                    const currentKey = tracklist.tracklist.map(t => t.trackhash).join('\n')

                    if (currentKey !== this.lastMirroredHashKey) {
                        // New context: the user navigated to a fresh album/playlist
                        // (components already set the local list) → replace the group
                        // queue. The server bounces it back as authoritative state.
                        void this.sendQueueSet({
                            trackhashes: tracklist.tracklist.map(t => t.trackhash),
                            from: tracklist.from as SyncFrom,
                            currentindex: index,
                            playing: true,
                            position_ms: 0,
                            repeat: settings.repeat,
                        })
                    } else {
                        void this.sendCmd('track_change', { index, position_ms: 0, playing: true })
                    }
                    break
                }
                case 'playPause': {
                    if (queue.playing) {
                        void this.sendCmd('pause', {})
                        break
                    }
                    if (this.lastMirroredHashKey === '' && tracklist.tracklist.length > 0) {
                        // Joined, but the group never got a queue (e.g. the seed
                        // failed). Pressing play would otherwise start audio only
                        // here while the server stays empty and every later
                        // track_change is refused. Seed and start in one go.
                        void this.sendQueueSet({
                            playing: true,
                            position_ms: usePlayer().getCurrentTimeMs(),
                        })
                        break
                    }
                    void this.sendCmd('play', {})
                    break
                }
                case 'seek': {
                    const posSeconds = typeof args[0] === 'number' ? args[0] : 0
                    // Optimistic thumb: the progress bar must not snap back for
                    // ~1 s until the command echoes back (audio stays untouched).
                    queue.setCurrentDuration(posSeconds)
                    void this.sendCmd('seek', { position_ms: Math.round(posSeconds * 1000) })
                    break
                }
                case 'playNext': {
                    const upcoming = this.upcomingIndex()
                    const len = tracklist.tracklist.length
                    let index = queue.nextindex
                    if (upcoming !== null) {
                        if (settings.repeat === 'one') index = upcoming
                        else if (settings.shuffle && len > 1) index = pickShuffleIndex(len, upcoming, queue.shuffleRecent)
                        else index = upcoming === len - 1 ? 0 : upcoming + 1
                    }
                    void this.sendCmd('track_change', { index, position_ms: 0, playing: true })
                    break
                }
                case 'playPrev': {
                    // Right after a Next, Previous undoes it: back to the track
                    // still playing here, from its start.
                    if (this.upcomingIndex() !== null) {
                        void this.sendCmd('track_change', { index: queue.currentindex, position_ms: 0, playing: true })
                        break
                    }
                    // Solo semantics preserved: >3 s into the track, Previous
                    // restarts the current track instead of jumping the group.
                    if (usePlayer().getCurrentTimeMs() > 3000) {
                        queue.setCurrentDuration(0)
                        void this.sendCmd('seek', { position_ms: 0 })
                    } else {
                        void this.sendCmd('track_change', { index: queue.previndex, position_ms: 0, playing: true })
                    }
                    break
                }
                case 'insertTracks': {
                    // "Play next" / "add to queue" while joined: broadcast the
                    // would-be list as the new group queue (the server bounces
                    // it back as authoritative state). Live: the song playing
                    // now carries on — nobody seeks.
                    const toInsert = (args[0] as Track[]) ?? []
                    const at = typeof args[1] === 'number' ? args[1] : tracklist.tracklist.length
                    const hashes = tracklist.tracklist.map(t => t.trackhash)
                    hashes.splice(at, 0, ...toInsert.map(t => t.trackhash))
                    // "Play next" right after a Next lands exactly ON the row the
                    // group is heading to, which slides down with the insert.
                    const group = this.groupPosition()
                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: at <= group.index ? group.index + toInsert.length : group.index,
                        playing: group.playing,
                        position_ms: usePlayer().getCurrentTimeMs(),
                        repeat: useSettings().repeat,
                        live: true,
                    })
                    break
                }
                case 'removeTracks': {
                    // "Remove from queue" while joined: broadcast the would-be
                    // list, same as insertTracks. The index has to travel with
                    // it — the server clamps, but only WE know whether the
                    // removal sits before, on, or after the current track.
                    const at = args[0] as number
                    const hashes = tracklist.tracklist.map(t => t.trackhash)
                    if (!Number.isInteger(at) || at < 0 || at >= hashes.length) break

                    const removedCurrent = at === queue.currentindex

                    // Who takes over — asked BEFORE the splice, while
                    // `nextindex` still numbers the list it was computed from.
                    // The same question the solo path answers (#506), and it has
                    // to be the same answer: keeping `at` assumes the successor
                    // is the row below, which is only true in sequential order.
                    // Under shuffle it is a pre-rolled row somewhere else — and
                    // the leader's own auto-advance already honours exactly that
                    // row (`track_change` with `queue.nextindex`), so the two
                    // halves contradicted each other and every device landed on
                    // the wrong track together (#518).
                    //
                    // `nextindex === at` only under `repeat: 'one'`, where it
                    // hands back the row that is going away.
                    const successor =
                        queue.nextindex === at ? (at === hashes.length - 1 ? 0 : at + 1) : queue.nextindex

                    hashes.splice(at, 1)

                    // The successor is a PRE-splice number; the splice renumbers
                    // everything after `at`. Never null — `successor` differs
                    // from `at` by construction, and the one case where it
                    // cannot (a queue of one) leaves no list to index into.
                    // Any other removal keeps where the group is — or is heading,
                    // unless the row going away is exactly that target.
                    const group = this.groupPosition()
                    const keep = at === group.index ? { index: queue.currentindex, playing: queue.playing } : group
                    const target = removedCurrent ? successor : keep.index
                    const index = hashes.length === 0 ? 0 : (shiftAfterRemove(target, at) as number)

                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: index,
                        playing: removedCurrent ? queue.playing : keep.playing,
                        position_ms: removedCurrent ? 0 : usePlayer().getCurrentTimeMs(),
                        repeat: settings.repeat,
                        // The successor STARTS; any other removal is an edit
                        // while the current song carries on.
                        live: !removedCurrent,
                    })
                    break
                }
                case 'moveTrack': {
                    // Reordering the queue while joined: broadcast the would-be
                    // list, same as insertTracks/removeTracks. The index travels
                    // with it because only this client knows whether the dragged
                    // row passed OVER the playing track — the server would have
                    // to guess, and a reorder must never become a track change.
                    const at = args[0] as number
                    const gap = args[1] as number
                    const hashes = tracklist.tracklist.map(t => t.trackhash)
                    const group = this.groupPosition()
                    const move = resolveQueueMove(hashes.length, at, gap, group.index)
                    if (!move) break

                    const [hash] = hashes.splice(at, 1)
                    hashes.splice(move.finalIndex, 0, hash)

                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: move.currentindex,
                        playing: group.playing,
                        position_ms: usePlayer().getCurrentTimeMs(),
                        repeat: settings.repeat,
                        live: true,
                    })
                    break
                }
                case 'clearQueue': {
                    // Empty queue = empty group queue. The server accepts it and
                    // bounces it back, so every device clears together.
                    void this.sendQueueSet({
                        trackhashes: [],
                        from: {} as SyncFrom,
                        currentindex: 0,
                        playing: false,
                        position_ms: 0,
                        repeat: settings.repeat,
                    })
                    break
                }
                case 'shuffleQueue': {
                    const hashes = tracklist.tracklist.map(t => t.trackhash)
                    const currentHash = hashes[queue.currentindex]
                    const rest = shuffleArray(hashes.filter((_, i) => i !== queue.currentindex))
                    const shuffled = currentHash !== undefined ? [currentHash, ...rest] : rest
                    void this.sendQueueSet({
                        trackhashes: shuffled,
                        from: tracklist.from as SyncFrom,
                        currentindex: 0,
                        playing: true,
                        position_ms: 0,
                        repeat: settings.repeat,
                    })
                    break
                }
                case 'toggleRepeat': {
                    void this.sendCmd('set_repeat', { repeat: args[0] })
                    break
                }
                default:
                    break
            }
        },

        /** Where the group goes when the current track ends: an index, or null to stop. */
        indexAfterEnd(): number | null {
            const queue = useQueue()
            const settings = useSettings()
            const len = useTracklist().tracklist.length
            const i = queue.currentindex

            if (len === 0) return null
            if (settings.repeat === 'one') return i

            // Permanent shuffle: the leader rolls for the whole group. It sends
            // the same pre-rolled target the solo path follows (`queue.nextindex`),
            // so the group jumps instead of walking the list — and because the
            // index travels inside the command, every device lands on the same
            // track. The queue end is no end while shuffling (#323), so this
            // sits above both repeat branches.
            if (settings.shuffle && len > 1) return queue.nextindex

            if (settings.repeat === 'all') return (i + 1) % len
            // repeat 'none': advance, or stop when the last track ends.
            return i >= len - 1 ? null : i + 1
        },

        /** The anchor identity a booking belongs to. */
        anchorKey(): string {
            const anchor = this.anchor
            return anchor ? `${this.queueId}|${useQueue().currentindex}|${anchor.at_server_ms}|${anchor.position_ms}` : ''
        },

        /**
         * Leader only: book the next track for the exact end of this one.
         *
         * Waiting for `ended` cost a command round trip plus the lead time —
         * about two seconds of silence between every two songs, on every
         * device. Booked a few seconds ahead, every device has the next track
         * loaded on its standby element and cuts over on the last sample.
         */
        bookNextTrack() {
            if (!this.isScrobbleLeader || !this.playing || pending || !this.anchor) return

            const queue = useQueue()
            const track = useTracklist().tracklist[queue.currentindex]
            if (!track || loadedTrackhash !== track.trackhash) return

            const tagSeconds = track.duration ?? 0
            const durationMs = usePlayer().durationMs() ?? (tagSeconds > 0 ? tagSeconds * 1000 : null)
            if (durationMs === null) return

            const endsAt = Math.round(this.anchor.at_server_ms + durationMs - this.anchor.position_ms)
            const remaining = endsAt - estimator.serverNow()
            if (remaining > BOOK_AHEAD_MS || remaining < BOOK_MIN_MS) return

            const key = this.anchorKey()
            if (bookedFor === key) return

            const next = this.indexAfterEnd()
            // The end of the queue: `ended` pauses the group, nothing to book —
            // and nothing may be marked booked, or `ended` would stand down.
            if (next === null) return
            bookedFor = key
            void this.sendCmd('track_change', { index: next, position_ms: 0, playing: true }, undefined, endsAt)
        },

        /** Audio ended in group mode: only the scrobble leader advances the group. */
        onTrackEnded() {
            if (!this.isScrobbleLeader) return

            // Already booked, or another transition is on its way: the group
            // switches on its own.
            if (pending || (bookedFor !== '' && bookedFor === this.anchorKey())) return

            // Nothing left to advance to (the queue was cleared mid-track): a
            // track_change into an empty session is refused with 400 and would
            // surface as an error toast on the leader's device.
            if (useTracklist().tracklist.length === 0) return

            const next = this.indexAfterEnd()
            if (next === null) {
                void this.sendCmd('pause', {})
                return
            }
            void this.sendCmd('track_change', { index: next, position_ms: 0, playing: true })
        },
    },
})
