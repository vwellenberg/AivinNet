// ---------------------------------------------------------------------------
// An arrival happens ONCE per element — the stylesheet alone cannot say that.
//
// `mem-step-in` (the staggered entrance of song rows and tiles, #143) is a CSS
// animation declared on the element. The assumption behind it was that such an
// animation runs when the node is CREATED and never again. That is only half
// true: a CSS animation also restarts whenever its node is detached and put
// back into the document — and a node that merely MOVES is exactly that.
//
// The virtual scrollers move their rows all the time. `RecycleScroller` sorts
// its view pool by item index ~300 ms after every scroll (`sortViews`, for text
// selection), and Vue carries that out with `insertBefore` on the row nodes.
// Measured over twelve wheel steps on a 394-track playlist: 70 rows re-ran
// their entrance after the scrolling had stopped — the list built itself up
// and then "flickered once more". The album grid did the same (53 tiles).
//
// So the arrival is latched: when it has played, the element gets
// `data-arrived`, and `mem-arrival` (_candy.scss) turns the animation off for
// it. A data attribute on purpose — Vue rewrites `class` whenever a bound class
// changes (a recycled row changes its band class constantly), but never touches
// an attribute nobody binds. And one listener on the document rather than a
// directive per component: it covers every `mem-arrival` user, including the
// next one somebody writes.
// ---------------------------------------------------------------------------

/** The staggered entrance of rows and tiles — the arrival `mem-arrival` runs. */
export const ARRIVAL_ANIMATION = 'mem-step-in'
/**
 * Every keyframe that counts as an arrival. `mem-plate-rise` is the Continue
 * card on Home: a keyed `v-for` item, so a refetch that changes the order of
 * the cards moves its node — and the card rose a second time, fill and pop
 * included.
 */
export const ARRIVAL_ANIMATIONS: ReadonlySet<string> = new Set([ARRIVAL_ANIMATION, 'mem-plate-rise'])
export const ARRIVED_ATTR = 'data-arrived'
/** Set when the entrance starts; seeing it again at a start means a RESTART. */
export const STARTED_ATTR = 'data-arrival-started'

// ⚠️ `animationend` alone is too late. Scroll down, then fast to the very top:
// the rows that come back are new nodes with a staggered entrance that is still
// running when the scroller's re-sort (~300 ms after the last scroll) moves
// them — the move restarts the animation BEFORE any `animationend` has latched
// it, so the entrance plays twice. A node that reports `animationstart` a second
// time has been restarted by a move; it has arrived as far as the user is
// concerned, so it is latched on the spot (and `animation: none` jumps it to its
// end state instead of replaying).
function onAnimationStart(e: AnimationEvent) {
    if (!ARRIVAL_ANIMATIONS.has(e.animationName) || e.pseudoElement) return
    if (!(e.target instanceof Element)) return
    if (e.target.hasAttribute(STARTED_ATTR)) e.target.setAttribute(ARRIVED_ATTR, '')
    else e.target.setAttribute(STARTED_ATTR, '')
}

function onAnimationEnd(e: AnimationEvent) {
    // The row's pseudo-elements animate too (band drop, texture wipe) and
    // report the row as their target — only the element's own entrance counts.
    if (!ARRIVAL_ANIMATIONS.has(e.animationName) || e.pseudoElement) return
    if (e.target instanceof Element) e.target.setAttribute(ARRIVED_ATTR, '')
}

export function installArrivalLatch(root: Document = document): () => void {
    // Capture phase: animation events bubble, but a handler below could stop them.
    root.addEventListener('animationstart', onAnimationStart, true)
    root.addEventListener('animationend', onAnimationEnd, true)
    return () => {
        root.removeEventListener('animationstart', onAnimationStart, true)
        root.removeEventListener('animationend', onAnimationEnd, true)
    }
}
