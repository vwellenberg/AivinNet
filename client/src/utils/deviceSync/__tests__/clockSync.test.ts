import { describe, expect, it } from 'vitest'
import { ClockOffsetEstimator } from '../clockSync'

// Handy sample builder: choose the offset and rtt you want, then derive a
// (t0, t1, t3) triple that produces them. Given t0 and rtt, t3 = t0 + rtt and
// t1 = offset + t0 + rtt/2 (inverting offset = t1 - t0 - rtt/2).
function triple(offset: number, rtt: number, t0 = 1000): [number, number, number] {
    const t3 = t0 + rtt
    const t1 = offset + t0 + rtt / 2
    return [t0, t1, t3]
}

describe('ClockOffsetEstimator', () => {
    it('starts empty with a zero offset and Infinite rtt', () => {
        const est = new ClockOffsetEstimator()
        expect(est.offset).toBe(0)
        expect(est.rtt).toBe(Infinity)
    })

    it('computes offset from a hand-worked sample', () => {
        const est = new ClockOffsetEstimator()
        // t0=1000, t1=5000, t3=1200 → rtt=200, offset = 5000 - 1000 - 100 = 3900
        est.addSample(1000, 5000, 1200)
        expect(est.rtt).toBe(200)
        expect(est.offset).toBe(3900)
    })

    it('lets the lowest-RTT sample win over later high-RTT ones', () => {
        const est = new ClockOffsetEstimator()
        est.addSample(...triple(3900, 200)) // rtt 200
        est.addSample(...triple(3800, 600)) // higher rtt, ignored for best
        expect(est.offset).toBe(3900)
        expect(est.rtt).toBe(200)

        est.addSample(...triple(4000, 100)) // lower rtt → new best
        expect(est.offset).toBe(4000)
        expect(est.rtt).toBe(100)
    })

    it('rejects samples with rtt above MAX_RTT_MS, leaving the offset unchanged', () => {
        const est = new ClockOffsetEstimator()
        est.addSample(...triple(3900, 200))
        est.addSample(...triple(1234, 1500)) // rtt 1500 > 1000 → rejected
        expect(est.offset).toBe(3900)
        expect(est.rtt).toBe(200)
    })

    it('does not reset on a single outlier (jump guard)', () => {
        const est = new ClockOffsetEstimator()
        est.addSample(...triple(3900, 200))
        est.addSample(...triple(9900, 200)) // +6000 jump — held pending, not applied
        expect(est.offset).toBe(3900)

        est.addSample(...triple(3950, 200)) // back in range — clears the pending outlier
        expect(est.offset).toBe(3900) // earliest of the tied-rtt samples
    })

    it('resets the window after two consecutive jumped samples', () => {
        const est = new ClockOffsetEstimator()
        est.addSample(...triple(3900, 200))
        est.addSample(...triple(9900, 200)) // jump #1 (pending)
        expect(est.offset).toBe(3900)

        est.addSample(...triple(9950, 200)) // jump #2 → reset window to the new regime
        expect(est.offset).toBe(9900)
    })

    it('serverNow applies the estimated offset', () => {
        const est = new ClockOffsetEstimator()
        est.addSample(1000, 5000, 1200) // offset 3900
        expect(est.serverNow(10000)).toBe(13900)
    })
})
