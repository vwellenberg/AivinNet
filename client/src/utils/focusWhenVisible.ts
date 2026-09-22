/**
 * Focus an element as soon as it can actually take focus — i.e. once its
 * computed `visibility` is `visible`. Resolves `true` when focus landed.
 *
 * ⚠️ Waiting a fixed number of frames is a guess, and it guessed wrong (#137).
 * The context menu shows by flipping `visibility`, and a `hidden` element
 * refuses `focus()` without a word. How long it stays hidden after the flip is
 * not the component's to know:
 *
 *   The reduced-motion policy (Global/motion-policy.scss) sets
 *   `transition-duration: 0.01ms !important` on EVERY element. An element that
 *   declared no transition has `transition-property: all` by default — so under
 *   that policy every element transitions every property, the INHERITED
 *   `visibility` included. The flip then trickles down one nesting level per
 *   frame: measured in Chromium, the submenu was visible while its `.wrapper`
 *   and the items inside were still `hidden` two frames later.
 *
 * So this waits for the condition focus needs, not for time.
 */
export async function focusWhenVisible(el: HTMLElement | null | undefined, maxFrames = 30): Promise<boolean> {
    if (!el) return false

    for (let frame = 0; frame < maxFrames; frame += 1) {
        if (getComputedStyle(el).visibility === 'visible') {
            el.focus()
            if (document.activeElement === el) return true
        }
        await nextFrame()
    }

    return false
}

function nextFrame(): Promise<void> {
    return new Promise(resolve => {
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve())
        else setTimeout(resolve, 16)
    })
}
