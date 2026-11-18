/**
 * Tell when a phone's on-screen keyboard has been CLOSED.
 *
 * ⚠️ Closing the keyboard (back gesture, back key, the keyboard's own hide
 * key) does not blur the field: it stays focused with the keyboard gone. And
 * Android asks for the keyboard only on a real focus CHANGE, so a tap on that
 * still-focused field changes nothing and the keyboard never comes back —
 * reported as "the keyboard opens only the first time" (Galaxy S22, Vivaldi,
 * 2026-11-18). Blurring and re-focusing inside the same tap did not count as a
 * change either. What works is leaving the field when the keyboard goes:
 * the next tap is then an ordinary first focus, which the browser answers
 * with the keyboard by itself.
 *
 * There is no "keyboard closed" event. What there is: the visual viewport
 * loses the keyboard's height while it is open and gets it back when it
 * closes — whether the browser resizes only the visual viewport (Chrome's
 * default since 108) or the layout viewport too. So this watches the visual
 * viewport's height against the tallest height seen at the current width.
 *
 * Pure state over (width, height) readings, so it is testable without a
 * browser; `watchKeyboardClose` wires it to `window.visualViewport`.
 */

/** Less than this below the tallest height is a toolbar showing or hiding, not a keyboard. */
export const KEYBOARD_MIN_HEIGHT = 150

export function keyboardTracker(minHeight = KEYBOARD_MIN_HEIGHT) {
    let width = -1
    let tallest = 0
    let open = false

    /** Feed one viewport reading; returns true when it means "the keyboard just closed". */
    return function reading(w: number, h: number): boolean {
        // A new width is a rotation or a resized window: start over, so the
        // other orientation's height is not mistaken for a keyboard.
        if (w !== width) {
            width = w
            tallest = h
            open = false
            return false
        }

        if (h > tallest) tallest = h
        const nowOpen = tallest - h >= minHeight
        const closed = open && !nowOpen
        open = nowOpen
        return closed
    }
}

/**
 * Call `onClose` whenever the on-screen keyboard closes. Returns the
 * unsubscribe. A no-op where the browser has no visual viewport.
 */
export function watchKeyboardClose(onClose: () => void): () => void {
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    if (!vv) return () => {}

    const reading = keyboardTracker()
    reading(vv.width, vv.height)

    const onResize = () => {
        if (reading(vv.width, vv.height)) onClose()
    }
    vv.addEventListener('resize', onResize)
    return () => vv.removeEventListener('resize', onResize)
}
