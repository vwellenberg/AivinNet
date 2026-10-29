import { celebrate } from '@/utils/confetti'
import { useToast } from '@/stores/notification'

// ---------------------------------------------------------------------------
// A milestone play (#545): the server counts the user's plays and answers the
// round ones (1,000, 1,337, 10,000, 100,000) with the play's number and track.
// The page celebrates it once: a toast, and a burst of Memphis shapes over the
// player bar.
//
// The burst is `celebrate()` from confetti.ts, which makes nothing under
// "less motion" (prefers-reduced-motion). The toast is not part of that rule,
// so the number still reaches the user there.
// ---------------------------------------------------------------------------

/** What the server sends back for a milestone play (`milestone` of POST /logger/track/log). */
export interface Milestone {
    number: number
    track: string | null
}

const PIECES = 40

/** "Play #10,000: Blue" — the words of the toast. */
export function milestoneText(milestone: Milestone): string {
    const number = milestone.number.toLocaleString('en-US')
    return `Play #${number}: ${milestone.track ?? 'Unknown track'}`
}

/** The middle of the player bar, in viewport pixels; the burst starts there. */
function barCentre(): { x: number; y: number } | undefined {
    if (typeof document === 'undefined') return undefined
    const bar = document.querySelector('.b-bar')
    if (!bar) return undefined

    const box = bar.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
}

export function celebrateMilestone(milestone: Milestone): void {
    useToast().showSuccess(milestoneText(milestone))
    celebrate(PIECES, barCentre())
}
