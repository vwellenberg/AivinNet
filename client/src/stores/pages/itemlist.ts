import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { Album } from '@/interfaces'
import { getAllItems } from '@/requests/getall'
import { Routes, router } from '@/router'

const state = () => {
    const total = ref(0)

    const items = ref(<Album[]>[])

    const sortby = ref('created_date')

    const reverse = ref(true)

    const reverse_string = computed(() => {
        return reverse.value ? '1' : ''
    })

    let latestIndex = 0
    const canFetch = ref(true)
    const pageSize = 50

    function restart() {
        items.value = []
        latestIndex = 0
        return getAlbums(latestIndex)
    }

    function setSort(newval: string) {
        if (newval === sortby.value) {
            reverse.value = !reverse.value
            return
        }

        sortby.value = newval
        reverse.value = true
    }

    function setReverse(reverse_new: boolean) {
        reverse.value = reverse_new
    }

    async function getAlbums(start: number) {
        if (!canFetch.value) return

        // Nothing left to ask for. The fetcher stays mounted at the end of the
        // list, so without this every return to the bottom spent a whole chain
        // of requests on pages past the collection (#142).
        if (total.value && start >= total.value) return

        canFetch.value = false

        try {
            const res = await getAllItems(
                router.currentRoute.value.name == Routes.AlbumList ? 'albums' : 'artists',
                {
                    start,
                    limit: pageSize,
                    sortby: sortby.value,
                    reverse: reverse_string.value,
                }
            )

            // ⚠️ `useAxios` RESOLVES on failure — it returns `{ error, data:
            // undefined }`. Reading `data.total` off that threw a TypeError
            // past the `canFetch = true` line, so one dropped request left the
            // flag false and the list refused to load anything ever again.
            if (res.error || !res.data) return

            const { data } = res
            if (!total.value) {
                total.value = data.total
            }

            items.value.push(...data.items)
            latestIndex += pageSize
        } finally {
            canFetch.value = true
        }
    }

    function getMoreAlbums() {
        return getAlbums(latestIndex)
    }

    function clearStore(routeName: string) {
        setTimeout(() => {
            if (router.currentRoute.value.name == routeName) {
                return
            }

            items.value = []
            total.value = 0
            latestIndex = 0
            canFetch.value = true
        }, 5000)
    }

    return {
        total,
        items,
        sortby,
        reverse,
        canFetch,
        restart,
        setSort,
        setReverse,
        getAlbums,
        getMoreAlbums,
        clearStore,
    }
}

const afterRestore = (context: any) => {
    context.store.$state.items = []
    context.store.$state.total = 0
    context.store.$state.latestIndex = 0
    context.store.$state.canFetch = true
}

export const useAlbumList = defineStore('albumlistpage', state, {
    persist: {
        afterRestore: afterRestore,
    },
})

export const useArtistList = defineStore('artistlistpage', state, {
    persist: {
        afterRestore: afterRestore,
    },
})
