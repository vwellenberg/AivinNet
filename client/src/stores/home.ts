import { computed, reactive, toRaw } from 'vue'
import { defineStore } from 'pinia'

import { getHomePageData } from '@/requests/home'
import { HomePageItem } from '@/interfaces'
import { cardHash, withCardAt, withoutCard } from '@/utils/homeRows'
import { fetchCardCount, maxAbumCards } from './content-width'

export default defineStore('homepage', () => {
    const homepageData = reactive(<HomePageItem[]>{})

    // "Continue listening" is not a row: Home shows its items as cards on top,
    // newest first — as many side by side as the width allows (main.vue).
    const continueListening = computed(() => {
        // @ts-ignore
        const entry: HomePageItem | undefined = homepageData.continue_listening
        return entry ? entry.items : []
    })

    const homepageItems = computed(() => {
        const items = Object.entries(homepageData)
            .filter(([key, item]) => key !== 'continue_listening' && item.items.length > 0)
            .map(([key, item]) => Object.assign(item, { key }))
        items.sort((a, b) => a.position - b.position)

        return items
    })

    const routes = {
        recently_played: '/playlist/recentlyplayed',
        // top_streamed_weekly_artists: '',
        recently_added: '/playlist/recentlyadded',
    }

    const seeAllTexts = {
        recently_played: 'VIEW HISTORY',
    }

    // How many cards per row the LAST request asked for. Rows render as many
    // cards as fit the grid, so a window dragged wider than it was at load has
    // more columns than items — the rows stay short until we ask for more.
    let fetchedLimit = 0
    let inflight = false

    // Counts the fetches, so a put-back (`dropCard`) can tell whether the
    // server has answered since.
    let fetches = 0

    async function fetchAll() {
        fetches++
        const limit = fetchCardCount.value
        fetchedLimit = limit
        const data: { [key: string]: HomePageItem }[] = await getHomePageData(limit)
        let keys = []

        for (const [index, item] of data.entries()) {
            const key = Object.keys(item)[0]
            keys.push(key)
            // @ts-ignore
            homepageData[key] = item[key]
            // @ts-ignore
            // The server sends the rows in display order (continue listening,
            // because you listened, on repeat, recently played, for this
            // time, never played, artists you might like, forgotten favorites,
            // rediscover, on this day, collections, recently added) — the
            // index IS the position.
            homepageData[key].position = index
            // @ts-ignore
            // A row the server also serves as a playlist names it, and its
            // caption opens the whole list ("On repeat" …); a `url` still wins.
            homepageData[key].path = routes[key] ?? (item[key].playlist && `/playlist/${item[key].playlist}`)
            // @ts-ignore
            homepageData[key].seeAllText = seeAllTexts[key]

            if (item[key].url) {
                // @ts-ignore
                homepageData[key].path = item[key].url
            }
        }

        // remove keys not in response
        for (const key in homepageData) {
            if (!keys.includes(key)) {
                delete homepageData[key]
            }
        }
    }

    /** Refill the rows after the window grew past what was fetched. Never shrinks. */
    async function refetchIfWider() {
        if (inflight || !fetchedLimit || maxAbumCards.value <= fetchedLimit) return

        inflight = true
        try {
            await fetchAll()
        } finally {
            inflight = false
        }
    }

    /**
     * Take one card out of a row and its chips at once — "Not interested"
     * (#531) — and return how to put it back if the server refuses. Putting
     * back puts back THIS card where it stood, so a second card marked in the
     * meantime stays out; the chips come back as they were only while no
     * other change touched them. After a fetch in between, nothing is put
     * back: the server's answer is already there.
     */
    function dropCard(key: string, hash: string): () => void {
        // @ts-ignore
        const row: HomePageItem | undefined = homepageData[key]
        if (!row) return () => {}

        const index = row.items.findIndex(i => cardHash(i) === hash)
        const card = index >= 0 ? toRaw(row.items[index]) : undefined
        const chipsBefore = toRaw(row.chips)
        const after = withoutCard(toRaw(row.items), chipsBefore, hash)
        row.items = after.items
        row.chips = after.chips
        const fetched = fetches

        return () => {
            // @ts-ignore
            const now: HomePageItem | undefined = homepageData[key]
            if (!now || fetches !== fetched) return

            if (card) now.items = withCardAt(toRaw(now.items), card, index)
            // Read back through the store: the array is a reactive proxy of the one set.
            if (toRaw(now.chips) === after.chips) now.chips = chipsBefore
        }
    }

    /**
     * Fetch again if Home was fetched at all in this session — after a change
     * to the layout (Settings → Home, #532). Asked of the store, not of the
     * rows: a layout that hides every row leaves `homepageData` empty, and
     * Home is still loaded. One that was never loaded fetches when it opens.
     */
    async function refreshIfLoaded() {
        if (fetchedLimit) await fetchAll()
    }

    return {
        homepageData,
        homepageItems,
        continueListening,
        fetchAll,
        refetchIfWider,
        refreshIfLoaded,
        dropCard,
    }
})
