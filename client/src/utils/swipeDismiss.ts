// Swipe-to-dismiss for toasts — the pure part, so the thresholds are testable
// without a pointer. The component (components/Notification.vue) feeds it the
// horizontal travel, the toast's width and how fast the finger was moving.

/** Below this a press is a tap, not a swipe: the click still counts. */
export const SWIPE_SLOP_PX = 8

/** A slow drag dismisses once it crossed this share of the toast… */
const DISTANCE_SHARE = 0.35
/** …but never needs more than this, so a wide toast on a tablet stays easy. */
const DISTANCE_CAP_PX = 96

/** A flick dismisses early: this fast (px/ms) and at least this far. */
const FLICK_SPEED = 0.5
const FLICK_MIN_PX = 24

export function swipeDismisses(dx: number, width: number, speed: number): boolean {
    const travel = Math.abs(dx)
    if (travel >= Math.min(width * DISTANCE_SHARE, DISTANCE_CAP_PX)) return true
    return travel >= FLICK_MIN_PX && Math.abs(speed) >= FLICK_SPEED
}

/** The toast fades as it travels, so the gesture reads as "throwing it away". */
export function swipeOpacity(dx: number, width: number): number {
    if (width <= 0) return 1
    return Math.max(0.2, 1 - Math.abs(dx) / width)
}
