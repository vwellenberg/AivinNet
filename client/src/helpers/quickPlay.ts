import { computed, ref } from 'vue'

import type { Track } from '@/interfaces'

/** The shape of `searchTracks` (requests/searchMusic.ts): the first page of results. */
export type QuickPlaySearch = (query: string) => Promise<{ results: Track[]; more: boolean }>

export interface QuickPlayDeps {
    search: QuickPlaySearch
    /** Replace the queue with the results (as the search page does) and play `index`. */
    playNow: (query: string, tracks: Track[], index: number) => void
    /** Insert one track right after the current one. */
    playNext: (track: Track) => void
    /** Close the box after a track was started. */
    close: () => void
    /** Pause after the last keystroke before a search goes out. */
    debounceMs?: number
}

/** How many results the box lists. Enter can still reach the rest of the page. */
export const QUICK_PLAY_VISIBLE = 6

export const QUICK_PLAY_DEBOUNCE_MS = 150

/**
 * The logic of the Quick play box, without any DOM.
 *
 * - `query` is what the input holds. `results` is the page for the query last
 *   answered; `visible` is its top rows, and `selected` indexes `visible`.
 * - Every change of the text invalidates the requests already in flight, so a
 *   late answer for an older query never overwrites the list of the current one.
 * - Enter flushes the debounce, awaits the search for the CURRENT text and plays
 *   the selected row of that answer. It never plays a list from an earlier query.
 * - A new answer resets the selection to the best match (row 0).
 */
export function createQuickPlay(deps: QuickPlayDeps) {
    const debounceMs = deps.debounceMs ?? QUICK_PLAY_DEBOUNCE_MS

    const query = ref('')
    const results = ref<Track[]>([])
    const selected = ref(0)
    const searching = ref(false)
    const visible = computed(() => results.value.slice(0, QUICK_PLAY_VISIBLE))

    /** Bumped whenever the text changes or the box resets: identifies the current request. */
    let seq = 0
    let timer: ReturnType<typeof setTimeout> | null = null
    /** The text the latest request was made for ('' when none). */
    let requestedText = ''
    /** Settles when the latest request has been applied (or has failed). */
    let inFlight: Promise<void> = Promise.resolve()
    /**
     * A confirm is waiting for its answer. A second Enter (or a held, repeating
     * one) in that time would start the song again from the top.
     */
    let confirming = false
    /** The component is gone: nothing may play any more (`dispose`). */
    let disposed = false

    const text = () => query.value.trim()

    function clearTimer() {
        if (timer !== null) {
            clearTimeout(timer)
            timer = null
        }
    }

    function start(q: string): void {
        const id = seq
        requestedText = q
        searching.value = true
        inFlight = deps
            .search(q)
            // `useAxios` does not reject: a failed search RESOLVES to undefined
            // (offline) or to the error body (`{ msg }` on a 4xx/5xx). Only a
            // list counts as an answer; the catch covers anything that throws.
            .then(page => {
                if (id !== seq) return
                results.value = Array.isArray(page?.results) ? page.results : []
                selected.value = 0
            })
            .catch(() => {
                if (id !== seq) return
                results.value = []
                selected.value = 0
            })
            .finally(() => {
                if (id === seq) searching.value = false
            })
    }

    function setQuery(raw: string) {
        query.value = raw
        seq++
        clearTimer()
        if (!text()) {
            results.value = []
            selected.value = 0
            searching.value = false
            requestedText = ''
            return
        }
        // Searching from the first keystroke, not from when the debounce fires:
        // otherwise "No match" flashes for the debounce whenever the list is empty.
        searching.value = true
        timer = setTimeout(() => {
            timer = null
            start(text())
        }, debounceMs)
    }

    function move(delta: number) {
        const count = visible.value.length
        if (count === 0) return
        selected.value = Math.min(count - 1, Math.max(0, selected.value + delta))
    }

    function select(index: number) {
        if (index >= 0 && index < visible.value.length) selected.value = index
    }

    /**
     * Enter (or Shift+Enter): play the selected row of the search for the current
     * text, waiting for that search if it is still pending. Does nothing when
     * the text is empty or the search found nothing.
     */
    async function confirm(shift = false): Promise<void> {
        if (confirming) return
        confirming = true
        try {
            await settleAndPlay(shift)
        } finally {
            confirming = false
        }
    }

    async function settleAndPlay(shift: boolean): Promise<void> {
        const q = text()
        if (!q) return

        // Debounce still running, or no request made for this text yet: send it now.
        if (timer !== null || requestedText !== q) {
            clearTimer()
            start(q)
        }

        const mine = seq
        await inFlight
        if (disposed) return

        // The text changed while the answer was on its way, so that answer is for
        // an older query. Decide again with what is there now.
        if (mine !== seq) return settleAndPlay(shift)

        const index = selected.value
        const track = results.value[index]
        if (!track) return

        if (shift) {
            deps.playNext(track)
        } else {
            deps.playNow(q, results.value, index)
        }
        deps.close()
    }

    /** Clears the box for the next opening. Pending answers are dropped. */
    function reset() {
        seq++
        clearTimer()
        query.value = ''
        results.value = []
        selected.value = 0
        searching.value = false
        requestedText = ''
    }

    /** Stops timers and drops pending answers (component unmount). */
    function dispose() {
        disposed = true
        seq++
        clearTimer()
    }

    return {
        query,
        results,
        visible,
        selected,
        searching,
        setQuery,
        move,
        select,
        confirm,
        reset,
        dispose,
    }
}
