// Easter egg (#544, #828): seven fast clicks on the app icon receive a signal —
// a find from the user's own library. The planet hands over a plate with one
// album of "Never played" or one track of "Forgotten favorites"
// (`GET /nothome/signal`), to play or to swap for another. Shared by the
// desktop logo (Logo.vue) and the phone's top-bar icon (NavBar.vue); the plate
// itself is drawn once, by SignalFind.vue in App.vue.
//
// Before the find it was a show: radio waves, static and a tube flash across
// the whole screen (#656). The user grew tired of it — a gimmick that answers
// with something to listen to stays worth the clicks.
import { type Ref, ref } from 'vue'

import { getSignalFind, type SignalFind } from '@/requests/home'

export const CLICKS_NEEDED = 7
/** Seven clicks inside this window. 2 s was too tight to hit on purpose. */
export const CLICK_WINDOW_MS = 3000
/** How long the plate stays when nobody touches it (SignalFind.vue). */
export const AUTO_CLOSE_MS = 10_000

/** Where the plate hangs: under the icon that was clicked, in viewport px. */
export type PlateAnchor = { left: number; top: number; right: number }

/**
 * The plate on screen. `find` is null while the server answers and when
 * there is nothing to find (`empty`).
 */
export type SignalPlate = {
    id: number
    anchor: PlateAnchor
    find: SignalFind | null
    loading: boolean
    empty: boolean
}

// Module state, not per component: the desktop logo and the phone icon both
// open the one plate App.vue draws.
const plate = ref<SignalPlate | null>(null)
let nextId = 1
// Only the newest request writes: "Another" twice, or a close in between,
// must not let an older answer land on the plate.
let latest = 0

/** The plate in progress, or null. Read by SignalFind.vue; changed only through the functions here. */
export function useSignalPlate(): Readonly<Ref<SignalPlate | null>> {
    return plate
}

/** Test hook (testing.md: no module-registry resets with Pinia). */
export function __resetSignalTestState() {
    plate.value = null
    latest++
}

/** The identity of a find: what "Another" asks the server to skip. */
export function findHash(find: SignalFind | null): string | undefined {
    if (!find) return undefined
    return find.type === 'album' ? find.item.albumhash : find.item.trackhash
}

function anchorOf(origin: Element | null | undefined): PlateAnchor {
    if (!origin) return { left: 16, top: 72, right: 16 }
    const r = origin.getBoundingClientRect()
    return { left: r.left, top: r.bottom, right: r.right }
}

async function receive(skip?: string) {
    const mine = ++latest
    const current = plate.value
    if (!current) return
    current.loading = true

    let find: SignalFind | null = null
    try {
        find = await getSignalFind(skip)
    } catch {
        find = null
    }

    if (mine !== latest || plate.value?.id !== current.id) return
    plate.value = { ...current, find, loading: false, empty: find === null }
}

function launch(origin: Element | null | undefined) {
    // Seven clicks again while a plate is up: a fresh find, same plate.
    if (plate.value) {
        void receive(findHash(plate.value.find))
        return
    }
    plate.value = { id: nextId++, anchor: anchorOf(origin), find: null, loading: true, empty: false }
    void receive()
}

/** "Another": a different find on the same plate. */
export function anotherFind() {
    if (plate.value) void receive(findHash(plate.value.find))
}

/** Close the plate; an answer still on its way is dropped. */
export function closeSignalPlate() {
    latest++
    plate.value = null
}

export function useLogoSignal() {
    let clicks: number[] = []

    /** Observes a click only; the icon keeps doing whatever its click does. */
    function registerClick(origin?: Element | null) {
        const now = Date.now()
        clicks = [...clicks, now].slice(-CLICKS_NEEDED)
        if (clicks.length < CLICKS_NEEDED || now - clicks[0] > CLICK_WINDOW_MS) return
        clicks = []
        launch(origin)
    }

    return { registerClick }
}
