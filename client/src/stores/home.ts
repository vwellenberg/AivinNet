import { computed, reactive } from 'vue'
import { defineStore } from 'pinia'

import { getHomePageData } from '@/requests/home'
import { HomePageItem } from '@/interfaces'
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

    async function fetchAll() {
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
            homepageData[key].path = routes[key]
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

    return {
        homepageData,
        homepageItems,
        continueListening,
        fetchAll,
        refetchIfWider,
    }
})
