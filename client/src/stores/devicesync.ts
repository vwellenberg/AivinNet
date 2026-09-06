// Multiroom device-sync store (client side of the "group session" feature).
//
// Server is the source of truth. This store short-polls the session, feeds a
// Cristian clock-offset estimator, mirrors the authoritative queue/transport
// state under a re-entrancy guard (`applying`), executes server-scheduled
// commands at the right local time (with catch-up for missed ones), and steers
// audio drift with a 250 ms playbackRate/seek loop while playing.
//
// C2 scope: the store + the store-side seams only. Nothing wires it into the
// UI/App yet, so solo behavior is unchanged (nothing calls the new store).
//
// Module-level singletons live OUTSIDE the reactive state (same pattern as
// player.ts's `audioSource`): timers, the estimator and the executed-command
// dedupe set must not be proxied by Vue reactivity.

import { defineStore } from 'pinia'

import { clampOffset, loadAudioOffset, saveAudioOffset } from '@/utils/deviceSync/audioOffset'
import { computeCorrection, HARD_MS } from '@/utils/deviceSync/driftSteer'
import { ClockOffsetEstimator } from '@/utils/deviceSync/clockSync'
import { detectDeviceName, detectDeviceType, getOrCreateDeviceId } from '@/utils/deviceSync/deviceId'
import { expectedPositionMs } from '@/utils/deviceSync/expectedPosition'
import { resolveQueueMove } from '@/utils/queueMove'
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
/** A scheduled command this close to firing suppresses drift steering. */
const STEER_SUPPRESS_MS = 1000

// --- non-reactive module singletons -----------------------------------------

let estimator = new ClockOffsetEstimator()
const executedCommandIds = new Set<string>()

let pollTimer: any = null
let pollingActive = false
let steerTimer: any = null
let visibilityHandler: (() => void) | null = null

interface Scheduled {
    handle: any
    at: number
}
let scheduled: Scheduled[] = []

/** Cancel every pending scheduled command timer (on leave/solo/queue swap). */
function clearScheduled() {
    for (const s of scheduled) clearTimeout(s.handle)
    scheduled = []
}

/**
 * Nesting depth of `withApplying` sections. A plain boolean would let an inner
 * section (e.g. a scheduled command firing during a mirror) clear the outer
 * section's flag prematurely.
 */
let applyDepth = 0

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
    clearScheduled()
    executedCommandIds.clear()
    estimator = new ClockOffsetEstimator()
    leaveSuppressUntil = 0
    autoRejoinSuppressUntil = 0
    applyDepth = 0
    lastTransportAt = 0
    loadedTrackhash = ''
    appliedRate = 1
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

function scheduledCommandNear(nowMs: number): boolean {
    return scheduled.some(s => Math.abs(s.at - nowMs) <= STEER_SUPPRESS_MS)
}

/** Whether a command's effect is a moving (playing) position — drives catch-up. */
function impliesPlaying(cmd: SyncCommand, playing: boolean): boolean {
    const p = (cmd.payload ?? {}) as any
    switch (cmd.type) {
        case 'play':
            return true
        case 'track_change':
            return p.playing !== false
        case 'seek':
            return playing
        default:
            return false
    }
}

/**
 * When the last transport command was executed. Right after a play/seek/track
 * change the device should snap onto the anchor hard instead of easing in over
 * seconds via playbackRate — that easing is exactly what "slightly offset"
 * sounds like at the start of a track.
 */
let lastTransportAt = 0
/** Hard-seek threshold during that snap window, and how long it lasts. */
const SNAP_WINDOW_MS = 2500
const SNAP_HARD_MS = 80

/** Reset drift steering to neutral rate — keeps `appliedRate` and the element in lockstep. */
function resetRate(player: ReturnType<typeof usePlayer>) {
    player.setPlaybackRate(1)
    appliedRate = 1
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
        anchor: null as SyncAnchor | null,
        /** Server truth for whether the session is playing. */
        playing: false,
        status: 'solo' as 'solo' | 'joined' | 'reconnecting',
        /** Autoplay-block overlay flag — consumed by the later UI PR. */
        needsGesture: false,
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
            this.withApplying(() => this.reconcileTransport())
        },

        // --- authoritative state mirroring ----------------------------------
        async applyState(state: SyncState): Promise<boolean> {
            // Queue identity = the server-computed queue_id (sha1 of hashes) —
            // no O(N) key building on the unchanged hot path.
            const queueChanged = state.queue_id !== this.queueId

            let tracks: Track[] | null = null
            if (queueChanged) {
                // Resolve OUTSIDE the applying guard (must not span an await).
                tracks = await resolveTracks(state.trackhashes)
                if (tracks.length === 0 && state.trackhashes.length > 0) {
                    // Resolve failed — keep the old mirror; queueId stays stale
                    // so the next poll retries.
                    return false
                }
            }

            this.withApplying(() => {
                if (queueChanged && tracks) {
                    // Pending scheduled commands were aimed at the OLD queue;
                    // a stale track_change index must not fire into this one.
                    clearScheduled()
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

                this.reconcileTransport()
            })
            return true
        },

        /**
         * Hard-align the audio element with the anchor: (re)load the current
         * track, seek to the expected position, and match play/pause. A best-
         * effort seek is fine — the steering loop converges any residual drift.
         */
        reconcileTransport() {
            if (!this.anchor) return
            const anchor = this.anchor

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
                }
                // Missing-track gap: fewer tracks resolved than hashes and the
                // current one is absent → stay paused-mirroring, do not crash.
                return
            }

            const expected = expectedPositionMs(anchor, estimator.serverNow(), this.playing) + this.audioOffsetMs
            const trackDiffers = loadedTrackhash !== current.trackhash
            const drift = Math.abs(player.getCurrentTimeMs() - expected) > HARD_MS
            const playMismatch = queue.playing !== this.playing

            if (!trackDiffers && !drift && !playMismatch) return

            queue.playing = this.playing
            resetRate(player)

            if (trackDiffers) {
                player.playCurrent()
                loadedTrackhash = current.trackhash
            } else if (this.playing) {
                void audioSource.playPlayingSource()
            } else {
                audioSource.pausePlayingSource()
            }

            player.hardSeekMs(expected)
        },

        // --- command handling -----------------------------------------------
        handleCommands(cmds: SyncCommand[]) {
            for (const cmd of cmds) {
                if (executedCommandIds.has(cmd.id)) continue
                // Add before executing: the server re-delivers pending commands
                // during a grace window, so dedupe strictly by id.
                rememberCommandId(cmd.id)

                if (cmd.target_device !== null && cmd.target_device !== undefined) {
                    if (cmd.target_device !== this.deviceId) continue
                    this.handleTargeted(cmd)
                } else {
                    this.scheduleCommand(cmd)
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

        scheduleCommand(cmd: SyncCommand) {
            const localExecMs = cmd.execute_at_ms - estimator.offset
            const now = Date.now()
            const delay = localExecMs - now

            if (delay <= 0) {
                // Missed window: execute now, catching up the position by however
                // long ago the command was meant to fire (only while playing).
                const catchUp = impliesPlaying(cmd, this.playing)
                    ? Math.max(0, estimator.serverNow() - cmd.execute_at_ms)
                    : 0
                this.executeCommand(cmd, catchUp)
                return
            }

            const entry: Scheduled = { handle: null, at: localExecMs }
            entry.handle = setTimeout(() => {
                scheduled = scheduled.filter(s => s !== entry)
                this.executeCommand(cmd, 0)
            }, delay)
            scheduled.push(entry)
        },

        executeCommand(cmd: SyncCommand, extraMs = 0) {
            // A timer that outlived the membership (leave/toSolo raced the
            // clearScheduled) must never touch solo playback.
            if (!this.joined) return

            const p = (cmd.payload ?? {}) as any
            const queue = useQueue()
            const player = usePlayer()

            // Opens the snap window: for the next couple of seconds the steerer
            // is allowed to hard-seek small offsets instead of easing them out.
            lastTransportAt = Date.now()

            this.withApplying(() => {
                switch (cmd.type) {
                    case 'play': {
                        queue.playing = true
                        void audioSource.playPlayingSource()
                        if (typeof p.position_ms === 'number') {
                            player.hardSeekMs(p.position_ms + extraMs)
                        }
                        break
                    }
                    case 'pause': {
                        queue.playing = false
                        audioSource.pausePlayingSource()
                        resetRate(player)
                        if (typeof p.position_ms === 'number') {
                            player.hardSeekMs(p.position_ms)
                        }
                        break
                    }
                    case 'seek': {
                        resetRate(player)
                        player.hardSeekMs((p.position_ms ?? 0) + extraMs)
                        break
                    }
                    case 'track_change': {
                        const tracklist = useTracklist()
                        const len = tracklist.tracklist.length
                        if (len === 0) break

                        // Bounds-guard: a stale command may carry an index from
                        // a longer, since-replaced queue.
                        const index =
                            typeof p.index === 'number'
                                ? Math.max(0, Math.min(p.index, len - 1))
                                : queue.currentindex
                        const wantPlaying = p.playing !== false

                        const indexMoved = queue.currentindex !== index
                        queue.currentindex = index
                        // Same reason as in applyState: the group's track change
                        // is this device's track change, and the shuffle target
                        // is stale the moment the index moves.
                        if (indexMoved) queue.rollShuffleNext()
                        queue.playing = wantPlaying
                        resetRate(player)

                        const target = tracklist.tracklist[index]
                        if (target && loadedTrackhash === target.trackhash) {
                            // Same track already loaded (e.g. a queue-set that
                            // kept the current track): align without reloading.
                            if (wantPlaying) void audioSource.playPlayingSource()
                            else audioSource.pausePlayingSource()
                        } else {
                            player.playCurrent()
                            loadedTrackhash = target?.trackhash ?? ''
                        }
                        player.hardSeekMs((p.position_ms ?? 0) + extraMs)
                        break
                    }
                    case 'set_repeat': {
                        useSettings().repeat = p.repeat as RepeatMode
                        break
                    }
                    default:
                        break
                }
            })
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
            // needsGesture: audio is autoplay-blocked — steering would hard-seek
            // a frozen element every tick for nothing.
            if (!this.joined || !this.anchor || this.applying || this.needsGesture) return
            const anchor = this.anchor
            // Don't fight a seek/track-change that's about to fire.
            if (scheduledCommandNear(Date.now())) return

            const player = usePlayer()
            const expected = expectedPositionMs(anchor, estimator.serverNow(), this.playing) + this.audioOffsetMs

            if (!this.playing) {
                // Paused: no rate steering, but recover a lost seek — e.g. the
                // element was still loading when reconcileTransport seeked, so
                // the position silently reset to 0.
                if (Math.abs(player.getCurrentTimeMs() - expected) > HARD_MS) {
                    player.hardSeekMs(expected)
                    resetRate(player)
                }
                return
            }

            const currentMs = player.getCurrentTimeMs()

            // Snap window right after a transport command: land ON the anchor
            // instead of easing a fresh offset out over several seconds at
            // ±4% rate (which is what an audible lag at track start was).
            if (Date.now() - lastTransportAt < SNAP_WINDOW_MS && Math.abs(currentMs - expected) > SNAP_HARD_MS) {
                player.hardSeekMs(expected)
                resetRate(player)
                return
            }

            const correction = computeCorrection(currentMs, expected)

            if (correction.action === 'rate') {
                player.setPlaybackRate(correction.rate)
                appliedRate = correction.rate
            } else if (correction.action === 'seek') {
                player.hardSeekMs(correction.seekToMs)
                resetRate(player)
            } else if (appliedRate !== 1) {
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
        async joinInternal() {
            if (!this.deviceId) return
            const t0 = Date.now()
            const res = await joinGroup(this.deviceId)
            const snap = res?.data as PollResponse | undefined

            this.joined = true
            this.status = 'joined'
            this.pollFailures = 0
            // Remembered across reloads so an involuntary drop-out can rejoin.
            rememberMembership(true)

            // A crossfade/preload timer armed while solo must not fire a local
            // advance into the group session.
            const player = usePlayer()
            player.clearMovingNextTimeout()
            player.clearNextAudio()

            const snapState = snap?.state
            const emptySession = !snapState || (snapState.trackhashes?.length ?? 0) === 0

            // Pin the clock down BEFORE the first mirror/scheduled command, so
            // playback does not start on a single noisy offset sample.
            if (snap && typeof snap.server_now_ms === 'number') {
                estimator.addSample(t0, snap.server_now_ms, Date.now())
            }
            await this.calibrateClock()

            if (emptySession && useTracklist().tracklist.length > 0) {
                // First joiner into an empty session seeds it from local state.
                if (snap && typeof snap.server_now_ms === 'number') {
                    estimator.addSample(t0, snap.server_now_ms, Date.now())
                }
                if (snap?.devices) this.devices = snap.devices
                this.scrobbleLeader = snap?.scrobble_leader ?? null
                if (typeof snap?.version === 'number') this.sessionVersion = snap.version
                await this.sendQueueSet()
            } else {
                await this.applySnapshot(snap, t0)
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
            this.withApplying(() => this.reconcileTransport())
        },

        async applySnapshot(snap: PollResponse | undefined, t0: number) {
            if (!snap) return
            if (typeof snap.server_now_ms === 'number') {
                estimator.addSample(t0, snap.server_now_ms, Date.now())
            }
            this.devices = snap.devices ?? this.devices
            this.scrobbleLeader = snap.scrobble_leader ?? null
            const applied = snap.state ? await this.applyState(snap.state) : true
            this.handleCommands(snap.commands ?? [])
            // A failed state apply keeps known_version stale → server re-sends.
            if (applied && typeof snap.version === 'number') this.sessionVersion = snap.version
        },

        /** Voluntary leave: keep playing locally (dissolve-to-solo semantics). */
        async leave() {
            const id = this.deviceId
            leaveSuppressUntil = Date.now() + 10000
            // Deliberate exit → do not walk back in on the next poll.
            rememberMembership(false)
            this.toSolo()
            if (id) await leaveGroup(id)
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
            // Pending scheduled commands must not fire into solo playback.
            clearScheduled()
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
            })

            this.reportSyncFailure(res, 'Could not share the queue with the group')
        },

        async sendCmd(type: SyncCommandType, payload: unknown, target_device?: string) {
            const res = await sendCommand({ device_id: this.deviceId, type, payload, target_device })
            this.reportSyncFailure(res, 'Group playback command failed')
        },

        /**
         * Surface a rejected sync call instead of swallowing it.
         *
         * A silently dropped queue-set (422 on a fractional position) is exactly
         * what made group playback look "connected but dead": the UI showed the
         * group as joined while the server had no queue at all.
         */
        reportSyncFailure(res: { status?: number } | undefined, what: string) {
            const status = res?.status
            if (status === undefined || (status >= 200 && status < 300)) return

            console.error(`[devicesync] ${what} (HTTP ${status})`, res)
            useToast().showNotification(`${what} (HTTP ${status})`, NotifType.Error)
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
                    void this.sendCmd('track_change', { index: queue.nextindex, position_ms: 0, playing: true })
                    break
                }
                case 'playPrev': {
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
                    // it back as authoritative state).
                    const toInsert = (args[0] as Track[]) ?? []
                    const at = typeof args[1] === 'number' ? args[1] : tracklist.tracklist.length
                    const hashes = tracklist.tracklist.map(t => t.trackhash)
                    hashes.splice(at, 0, ...toInsert.map(t => t.trackhash))
                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: queue.currentindex,
                        playing: queue.playing,
                        position_ms: usePlayer().getCurrentTimeMs(),
                        repeat: useSettings().repeat,
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
                    const target = removedCurrent ? successor : queue.currentindex
                    const index = hashes.length === 0 ? 0 : (shiftAfterRemove(target, at) as number)

                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: index,
                        playing: queue.playing,
                        position_ms: removedCurrent ? 0 : usePlayer().getCurrentTimeMs(),
                        repeat: settings.repeat,
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
                    const move = resolveQueueMove(hashes.length, at, gap, queue.currentindex)
                    if (!move) break

                    const [hash] = hashes.splice(at, 1)
                    hashes.splice(move.finalIndex, 0, hash)

                    void this.sendQueueSet({
                        trackhashes: hashes,
                        from: tracklist.from as SyncFrom,
                        currentindex: move.currentindex,
                        playing: queue.playing,
                        position_ms: usePlayer().getCurrentTimeMs(),
                        repeat: settings.repeat,
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

        /** Audio ended in group mode: only the scrobble leader advances the group. */
        onTrackEnded() {
            if (!this.isScrobbleLeader) return

            const queue = useQueue()
            const tracklist = useTracklist()
            const settings = useSettings()
            const len = tracklist.tracklist.length
            const i = queue.currentindex

            // Nothing left to advance to (the queue was cleared mid-track): a
            // track_change into an empty session is refused with 400 and would
            // surface as an error toast on the leader's device.
            if (len === 0) return

            if (settings.repeat === 'one') {
                void this.sendCmd('track_change', { index: i, position_ms: 0, playing: true })
                return
            }

            // Permanent shuffle: the leader rolls for the whole group. It sends
            // the same pre-rolled target the solo path follows (`queue.nextindex`),
            // so the group jumps instead of walking the list — and because the
            // index travels inside the command, every device lands on the same
            // track. Sequential order below would otherwise ignore the toggle
            // entirely: shuffle only ever reached the group through a manual
            // "Next". The queue end is no end while shuffling (#323), so this
            // sits above both repeat branches.
            if (settings.shuffle && len > 1) {
                void this.sendCmd('track_change', { index: queue.nextindex, position_ms: 0, playing: true })
                return
            }

            if (settings.repeat === 'all') {
                const next = len > 0 ? (i + 1) % len : 0
                void this.sendCmd('track_change', { index: next, position_ms: 0, playing: true })
                return
            }
            // repeat 'none': advance, or pause the group when the last track ends.
            if (i >= len - 1) {
                void this.sendCmd('pause', {})
            } else {
                void this.sendCmd('track_change', { index: i + 1, position_ms: 0, playing: true })
            }
        },
    },
})
