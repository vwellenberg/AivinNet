<template>
    <NoItems
        :title="`No ${page} results`"
        :description="desc"
        :icon="SearchSvg"
        :flag="!items.length"
        v-if="showNoItemsComponent"
    />
    <div class="v-scroll-page" style="height: 100%">
        <DynamicScroller style="height: 100%" class="scroller" :min-item-size="64" :items="scrollerItems">
            <template #before>
                <slot name="header"></slot>
                <!-- Zero-height probe with the exact width of every card row
                     below: the group size must match the CSS column count. -->
                <div ref="gridprobe" aria-hidden="true"></div>
            </template>
            <template #default="{ item, index, active }">
                <DynamicScrollerItem
                    :item="item"
                    :active="active"
                    :size-dependencies="[item.props]"
                    :data-index="index"
                >
                    <component :is="item.component" :key="index" v-bind="item.props"></component>
                </DynamicScrollerItem>
            </template>
        </DynamicScroller>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import useSearchStore from '@/stores/search'
import useCardGridColumns from '@/helpers/useCardGridColumns'

import SearchSvg from '@/assets/icons/search.svg'
import NoItems from '@/components/shared/NoItems.vue'
import CardRow from '@/components/shared/CardRow.vue'
import AlbumsFetcher from '@/components/ArtistView/AlbumsFetcher.vue'

const props = defineProps<{
    page?: 'album' | 'artist' | 'playlist'
    fetch_callback?: () => Promise<void>
    items: any[]
    outside_route?: boolean
    showNoItemsComponent?: boolean
}>()

const search = useSearchStore()

const desc = computed(() =>
    search.query === ''
        ? `Start typing to search for ${props.page}s`
        : `Results for '${search.query}' should appear here`
)

// Rows are partitioned by the columns the gapped grid really builds (see
// helpers/useCardGridColumns.ts) — except in the right sidebar's search tab
// (`outside_route`), where the narrow grid wraps by design and 6 per group
// simply caps how many cards a tab shows.
const gridprobe = ref<HTMLElement | null>(null)
const columns = useCardGridColumns(gridprobe)

const scrollerItems = computed(() => {
    let maxCards = columns.value

    if (props.outside_route) {
        maxCards = 6
    }

    const groups = Math.ceil(props.items.length / maxCards)
    const items = []

    for (let i = 0; i < groups; i++) {
        items.push({
            id: i,
            component: CardRow,
            props: {
                items: props.items.slice(i * maxCards, (i + 1) * maxCards),
            },
            key: i,
        })
    }

    const moreItems = props.page === 'album' ? search.albums.more : search.artists.more

    if (props.fetch_callback && moreItems) {
        items.push({
            id: Math.random(),
            component: AlbumsFetcher,
            props: {
                fetch_callback: props.fetch_callback,
                outside_route: props.outside_route,
            },
        })
    }

    return items
})
</script>
