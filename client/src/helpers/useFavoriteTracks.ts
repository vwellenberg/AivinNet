import { computed, ref, type Ref } from 'vue'

import useFuse from '@/utils/useFuse'
import { FuseTrackOptions } from '@/enums'
import { Track } from '@/interfaces'
import { getFavTracks } from '@/requests/favorite'

/**
 * The favorite tracks list: paginated loading for the infinite scroll, and a
 * find that searches every favorite (the rest is loaded on the first letter).
 *
 * Each track keeps `index` (its row number, counted from the newest) and
 * `master_index` (its position in the full list, what playing needs), so a
 * filtered list still shows and plays the right track.
 *
 * @param pageSize the page size for each request (read on every load)
 */
export function useFavoriteTracks(pageSize: () => number = () => 50) {
    const tracks: Ref<Track[]> = ref([])
    const trackCount = ref(0)
    const query = ref('')

    // Every load runs after the one before it: a page and the search's full
    // load can never both ask for the same start.
    let chain: Promise<void> = Promise.resolve()
    // The full load a search started; later letters join it instead of asking again.
    let searchLoad: Promise<void> | null = null

    // The server has answered at least once: before that, a count of 0 means
    // "unknown", after it "no favorites" — and an empty list is fully loaded.
    let answered = false
    const allLoaded = () => answered && tracks.value.length >= trackCount.value
    // The page request in flight: the infinite-scroll sentinel can fire again
    // before it lands, and each call must not queue one more page.
    let pageLoad: Promise<void> | null = null

    /** Fetches the window after the loaded tracks and appends it. Silent on failure. */
    async function fetchNext(limit: number): Promise<void> {
        if (allLoaded()) return
        const start = tracks.value.length
        let data: { tracks: Track[]; total: number } | undefined
        try {
            data = await getFavTracks(start, limit)
        } catch {
            return
        }
        // useAxios resolves with no data on failure instead of rejecting.
        if (!data || !Array.isArray(data.tracks)) return

        if (data.total !== -1) trackCount.value = data.total
        answered = true

        const startIndex = trackCount.value - start - 1
        tracks.value.push(
            ...data.tracks.map((t, i) => ({ ...t, index: startIndex - i, master_index: start + i }))
        )
    }

    function enqueue(task: () => Promise<void>): Promise<void> {
        const run = chain.then(task)
        chain = run.catch(() => {})
        return run
    }

    /** Next page for the infinite scroll. Paused while a search is on: setQuery loads the rest. */
    function loadMore(): Promise<void> {
        if (query.value || allLoaded()) return Promise.resolve()
        if (!pageLoad) {
            const done = enqueue(() => fetchNext(pageSize())).finally(() => {
                if (pageLoad === done) pageLoad = null
            })
            pageLoad = done
        }
        return pageLoad
    }

    /** Loads every remaining favorite, once, however often it is asked. */
    function loadAll(): Promise<void> {
        if (allLoaded()) return Promise.resolve()
        if (!searchLoad) {
            // A failed load leaves the list on the pages it has; the next call retries.
            const done = enqueue(() => fetchNext(-1)).finally(() => {
                if (searchLoad === done) searchLoad = null
            })
            searchLoad = done
        }
        return searchLoad
    }

    /** Sets the find. The first letter loads the rest of the list; a failure never rejects. */
    async function setQuery(value: string): Promise<void> {
        query.value = value
        if (!value || allLoaded()) return
        await loadAll()
    }

    const results = useFuse(query, tracks, FuseTrackOptions)

    /** The rows to show: every loaded track, or the matches while a query is set. */
    const visible = computed<Track[]>(() => {
        if (!query.value) return tracks.value
        return results.value.map(r => r.item as Track)
    })

    return { tracks, trackCount, query, visible, loadMore, loadAll, setQuery }
}
