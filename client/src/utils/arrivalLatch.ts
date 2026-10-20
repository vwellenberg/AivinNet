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
 *
 * The last three are the arrivals of whatever ELSE sits in a scroller view: a
 * button's pop, a caption sticker's slap, a stat tile's motif. The same move
 * restarted them — on the album page the head's four buttons and its sticker
 * popped in twice when scrolling back up. Their stylesheets honour the latch
 * only inside a scroller view (`btn-toggle-on` pops on purpose when switched on).
 */
export const ARRIVAL_ANIMATIONS: ReadonlySet<string> = new Set([
    ARRIVAL_ANIMATION,
    'mem-plate-rise',
    'btn-pop',
    'mem-sticker-slap',
    'mem-motif-pop',
])
/** A scroller's view: the only place the last three are latched. */
export const SCROLLER_VIEW = '.vue-recycle-scroller__item-view'
const SCROLLER_ONLY: ReadonlySet<string> = new Set(['btn-pop', 'mem-sticker-slap', 'mem-motif-pop'])

/** The element whose own arrival this event is, if it is one the latch keeps. */
function arrivalTarget(e: AnimationEvent): Element | null {
    if (!ARRIVAL_ANIMATIONS.has(e.animationName) || e.pseudoElement) return null
    if (!(e.target instanceof Element)) return null
    // Every button in the app pops; outside a scroller nothing moves it, and
    // marking them all would only leave attributes nobody reads.
    if (SCROLLER_ONLY.has(e.animationName) && !e.target.closest(SCROLLER_VIEW)) return null
    return e.target
}
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
    const el = arrivalTarget(e)
    if (!el) return
    if (el.hasAttribute(STARTED_ATTR)) el.setAttribute(ARRIVED_ATTR, '')
    else el.setAttribute(STARTED_ATTR, '')
}

function onAnimationEnd(e: AnimationEvent) {
    // The row's pseudo-elements animate too (band drop, texture wipe) and
    // report the row as their target — only the element's own entrance counts.
    arrivalTarget(e)?.setAttribute(ARRIVED_ATTR, '')
}

// ---------------------------------------------------------------------------
// ⚠️ The PLAYING row has a second arrival, and the latch above never saw it.
//
// `mem-now-playing-row` (_candy.scss) rings the state in on its pseudo-elements:
// the zigzag band drops in on `::after`, the sprinkle wipes in on `::before`.
// The same move restarts them. Measured on the queue page (200 tracks, wheel
// down, then back up): the playing row scrolls in, builds up, and ~580 ms
// later — the scroller's re-sort — builds up a second time, while every other
// row stayed still. Reported as "scrolling up the queue plays the build-up
// twice"; #370 had only latched the element's own entrance.
//
// Unlike the entrance, this one must be able to play AGAIN on the same node: a
// recycled row that shows the playing track later, a lyric line that becomes
// current a second time. So the latch is RELEASED when the host leaves the
// state — every host marks it with the class `current` (census in
// nowPlayingRow.test.ts).
// ---------------------------------------------------------------------------

/** The keyframes that ring the playing state in, on the row's pseudo-elements. */
export const NOW_PLAYING_ANIMATIONS: ReadonlySet<string> = new Set(['mem-band-drop', 'mem-texture-wipe'])
export const NOW_PLAYING_ARRIVED_ATTR = 'data-now-playing-arrived'
/** The class every host of `mem-now-playing-row` toggles for the state. */
export const NOW_PLAYING_CLASS = 'current'

// ---------------------------------------------------------------------------
// An arrival belongs to the page's BUILD, not to scrolling.
//
// A scroll jump further than the rendered range is "not continuous" to
// vue-virtual-scroller: it creates NEW views for the new range instead of
// freeing the old ones, and every new row then arrived mid-scroll — 13 rows on
// a playlist after five fast flicks back up. Once a scroller has scrolled, the
// arrival mixins (mem-arrival, btn-pop, mem-sticker, mem-motif-pop) leave
// whatever is built in its views as it is. The playing row's ornament is not
// among them: it rings in a state change, and a track change after scrolling
// is still one.
// ---------------------------------------------------------------------------

export const SCROLLED_ATTR = 'data-scrolled'
export const SCROLLER = '.vue-recycle-scroller'

function onScroll(e: Event) {
    // `scroll` does not bubble; the capture phase sees every scroller's.
    const el = e.target
    if (el instanceof Element && !el.hasAttribute(SCROLLED_ATTR) && el.matches(SCROLLER)) {
        el.setAttribute(SCROLLED_ATTR, '')
    }
}

export function installArrivalLatch(root: Document = document): () => void {
    // Which of a row's two ornament animations have started since it became
    // current. Per animation, not per row: `::before` and `::after` start in
    // the same frame, and the second of them is no restart.
    const started = new WeakMap<Element, Set<string>>()

    // A class change that drops the state releases the row. A microtask after
    // the patch, so before the next frame — the browser sees the row leave the
    // state and lose the latch together.
    const leaving = new MutationObserver(records => {
        for (const { target } of records) {
            if (!(target instanceof Element) || target.classList.contains(NOW_PLAYING_CLASS)) continue
            target.removeAttribute(NOW_PLAYING_ARRIVED_ATTR)
            started.delete(target)
        }
    })

    /**
     * An ornament event of a row that is in the state. One that arrives after
     * the class has gone (the frame it ends or starts in is the frame the row
     * leaves) must not latch it again behind the observer's back.
     */
    function ornamentHost(e: AnimationEvent): Element | null {
        if (!NOW_PLAYING_ANIMATIONS.has(e.animationName) || !e.pseudoElement) return null
        if (!(e.target instanceof Element) || !e.target.classList.contains(NOW_PLAYING_CLASS)) return null
        return e.target
    }

    function onOrnamentStart(e: AnimationEvent) {
        const row = ornamentHost(e)
        if (!row) return
        const key = e.pseudoElement + e.animationName
        const seen = started.get(row)
        if (seen?.has(key)) {
            row.setAttribute(NOW_PLAYING_ARRIVED_ATTR, '')
            return
        }
        if (seen) seen.add(key)
        else started.set(row, new Set([key]))
        // Watched from the first start, not from the latch: a row recycled
        // mid-animation never ends it, and its record must go all the same.
        leaving.observe(row, { attributes: true, attributeFilter: ['class'] })
    }

    function onOrnamentEnd(e: AnimationEvent) {
        ornamentHost(e)?.setAttribute(NOW_PLAYING_ARRIVED_ATTR, '')
    }

    // Capture phase: animation events bubble, but a handler below could stop them.
    root.addEventListener('animationstart', onAnimationStart, true)
    root.addEventListener('animationend', onAnimationEnd, true)
    root.addEventListener('animationstart', onOrnamentStart, true)
    root.addEventListener('animationend', onOrnamentEnd, true)
    // Before the scroller's own handler, so the views it builds for this very
    // scroll already find the flag.
    root.addEventListener('scroll', onScroll, { capture: true, passive: true })
    return () => {
        root.removeEventListener('animationstart', onAnimationStart, true)
        root.removeEventListener('animationend', onAnimationEnd, true)
        root.removeEventListener('animationstart', onOrnamentStart, true)
        root.removeEventListener('animationend', onOrnamentEnd, true)
        root.removeEventListener('scroll', onScroll, true)
        leaving.disconnect()
    }
}
