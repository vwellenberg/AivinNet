// Cristian-style clock-offset estimator for device sync.
//
// Each poll yields a round-trip triple (t0 client-sent, t1 server-now,
// t3 client-received). The offset between the local and server clocks is
// `t1 - t0 - rtt/2`; the estimate with the *lowest* round-trip time is the
// most trustworthy, so that sample wins. Pure module — no I/O, no timers.

/** Samples with a round-trip above this (ms) are too noisy to trust. */
export const MAX_RTT_MS = 1000

/** Rolling window size of accepted samples. */
export const MAX_SAMPLES = 10

/** Offset deviation (ms) from the current best that counts as a clock jump. */
export const JUMP_MS = 5000

/** Consecutive jumped samples required before we accept the new clock regime. */
export const JUMP_CONSECUTIVE = 2

interface Sample {
    offset: number
    rtt: number
}

export class ClockOffsetEstimator {
    private samples: Sample[] = []
    private pendingJump: Sample[] = []

    /**
     * Feed one round-trip measurement.
     * @param t0ClientSentMs local time the poll left the client
     * @param t1ServerNowMs server clock reported in the response
     * @param t3ClientRecvMs local time the response arrived
     */
    addSample(t0ClientSentMs: number, t1ServerNowMs: number, t3ClientRecvMs: number): void {
        const rtt = t3ClientRecvMs - t0ClientSentMs

        // Reject implausibly slow round-trips: RTT/2 is a poor delay estimate.
        if (rtt > MAX_RTT_MS) {
            return
        }

        const offset = t1ServerNowMs - t0ClientSentMs - rtt / 2
        const sample: Sample = { offset, rtt }

        // Clock-jump guard: a single outlier (NTP step, laptop wake, DST glitch)
        // must not corrupt the window. Only after JUMP_CONSECUTIVE consecutive
        // samples that all deviate from the current best do we accept the new
        // regime and reset the window to those samples.
        const currentBest = this.best
        if (currentBest && Math.abs(offset - currentBest.offset) > JUMP_MS) {
            this.pendingJump.push(sample)
            if (this.pendingJump.length >= JUMP_CONSECUTIVE) {
                this.samples = this.pendingJump.slice(-MAX_SAMPLES)
                this.pendingJump = []
            }
            return
        }

        // A normal in-range sample breaks any half-formed jump streak.
        this.pendingJump = []
        this.samples.push(sample)
        if (this.samples.length > MAX_SAMPLES) {
            this.samples.shift()
        }
    }

    /** The lowest-RTT sample currently in the window, or null when empty. */
    private get best(): Sample | null {
        let best: Sample | null = null
        for (const sample of this.samples) {
            if (best === null || sample.rtt < best.rtt) {
                best = sample
            }
        }
        return best
    }

    /** Estimated offset (ms) to add to a local clock: 0 when no samples yet. */
    get offset(): number {
        return this.best?.offset ?? 0
    }

    /** Round-trip time (ms) of the best sample: Infinity when no samples yet. */
    get rtt(): number {
        return this.best?.rtt ?? Infinity
    }

    /** Estimated server clock for a given local time (defaults to now). */
    serverNow(nowMs: number = Date.now()): number {
        return nowMs + this.offset
    }
}
