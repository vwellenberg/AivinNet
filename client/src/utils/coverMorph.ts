// ---------------------------------------------------------------------------
// Cover-Übergang: das Cover wandert aus der Albumkarte in den Detailkopf.
//
// The View Transitions API friert den alten Zustand ein, lässt die Route
// wechseln und verbindet beide Zustände. Ein Element, das in beiden denselben
// `view-transition-name` trägt, wird dabei nicht ausgeblendet, sondern von
// seiner alten Box in die neue bewegt und skaliert — das Cover landet dort, wo
// es im Kopf steht, statt eine Seite lang zu verschwinden.
//
// Nur ein Klick auf eine Albumkarte startet den Übergang (`armCoverMorph`, am
// Link). Alles andere navigiert wie bisher: ohne API, bei „weniger Bewegung",
// bei Modifier-Klicks (neuer Tab) und wenn der Klick zu lange her ist.
//
// ⚠️ Der Name hängt nur an DEM Element, das gerade wandert. Im Raster trägt
// sonst jede Karte denselben Namen wie das Cover im Kopf, und der Browser bricht
// den Übergang ab. Deshalb wird er erst gesetzt, wenn der Übergang beginnt, und
// danach wieder entfernt.
//
// ⚠️ Der Zustand „neu" muss stehen, bevor der Browser ihn fotografiert. Die
// Route ist in `afterEach` gewechselt, der Kopf aber noch nicht gerendert —
// daher wartet `finishCoverMorph` auf den Kopf und gibt den Übergang erst
// danach frei. Der Zustand „alt" wird schon in `beforeEach` eingefroren.
// ---------------------------------------------------------------------------

import { nextTick } from 'vue'

export const COVER_MORPH_NAME = 'album-cover'
/** The header cover on the album page. The scroller id is the only anchor. */
const HEADER_COVER = '#album-scroller .dh-art img'
/** A click arms the morph for this long. A navigation later than that is not the click's. */
const ARM_WINDOW_MS = 800
/** The header mounts in the first frames. Waiting longer than this shows the plain crossfade. */
const HEADER_WAIT_MS = 160
/** Release the new state even if no navigation finished (aborted or redirected). */
const SETTLE_TIMEOUT_MS = 1200

type ViewTransitionDocument = Document & {
    startViewTransition?: (update: () => Promise<void>) => { finished: Promise<void> }
}

let armed: { source: HTMLElement; at: number } | null = null
let releaseNewState: (() => void) | null = null
let morphTarget: HTMLElement | null = null

/** Click capture on the album card link: remember the cover the user pressed. */
export function armCoverMorph(source: HTMLElement | null, event: MouseEvent) {
    if (!source) return
    // A modifier click opens a new tab (RouterLink does not navigate) — no morph.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    armed = { source, at: Date.now() }
}

/** The API exists and the user has not asked for less motion. */
export function canMorph(): boolean {
    if (typeof document === 'undefined') return false
    if (typeof (document as ViewTransitionDocument).startViewTransition !== 'function') return false
    return !window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Router `beforeEach`: the route has not changed yet, so the old state is
 * still on screen and gets frozen now.
 */
export function beginCoverMorph(toAlbum: boolean) {
    const pending = armed
    armed = null
    if (!toAlbum || !pending || Date.now() - pending.at > ARM_WINDOW_MS || !canMorph()) return

    // A morph still waiting for its new state is superseded by this one.
    void finishCoverMorph()

    const source = pending.source
    source.style.viewTransitionName = COVER_MORPH_NAME

    // The promise is created here, not in the callback: the browser may run
    // the callback a frame later, and `finishCoverMorph` must already see it.
    let release: () => void = () => {}
    const newState = new Promise<void>(resolve => {
        release = resolve
    })
    releaseNewState = release

    const transition = (document as ViewTransitionDocument).startViewTransition?.(() => newState)
    if (!transition) {
        source.style.viewTransitionName = ''
        void finishCoverMorph()
        return
    }
    const clear = () => {
        source.style.viewTransitionName = ''
        if (morphTarget) morphTarget.style.viewTransitionName = ''
        morphTarget = null
    }
    transition.finished.then(clear, clear)

    window.setTimeout(() => {
        if (releaseNewState === release) void finishCoverMorph()
    }, SETTLE_TIMEOUT_MS)
}

/**
 * Router `afterEach`: the new route is set. Name the header cover once it is
 * in the DOM, then let the browser take the new state.
 */
export async function finishCoverMorph() {
    const release = releaseNewState
    if (!release) return
    releaseNewState = null

    await nextTick()
    let target = document.querySelector<HTMLElement>(HEADER_COVER)
    const deadline = Date.now() + HEADER_WAIT_MS
    while (!target && Date.now() < deadline) {
        await new Promise(resolve => window.setTimeout(resolve, 16))
        target = document.querySelector<HTMLElement>(HEADER_COVER)
    }

    if (target) {
        target.style.viewTransitionName = COVER_MORPH_NAME
        morphTarget = target
    }
    release()
}

/** Tests only: the module keeps its state between cases. */
export function __resetCoverMorphForTests() {
    armed = null
    releaseNewState = null
    morphTarget = null
}
