<template>
    <div class="statshead" v-if="statItems.length">
        <div class="left">
            <StatItem
                v-for="item in statItems.slice(0, statItems.length - 1)"
                :key="item.cssclass"
                :value="item.value"
                :text="item.text"
                :icon="item.cssclass"
                :image="item.image"
            />
        </div>
        <div class="right">
            <StatItem
                :value="statItems[statItems.length - 1].value"
                :text="statItems[statItems.length - 1].text"
                :icon="statItems[statItems.length - 1].cssclass"
                :image="statItems[statItems.length - 1].image"
            />
        </div>
    </div>
    <div class="statsdates" v-if="date">
        <div class="date">
            <CalendarSvg />
            {{ date }}
        </div>
    </div>
</template>

<script setup lang="ts">
import { getStats } from '@/requests/stats'
import { onMounted, ref } from 'vue'
import StatItem from './StatItem.vue'
import CalendarSvg from '@/assets/icons/calendar.svg'

interface StatItemData {
    cssclass: string
    value: string
    text: string
    image?: string
}

const props = defineProps<{
    items?: StatItemData[]
}>()

const statItems = ref<StatItemData[]>([])
const date = ref<string | null>(null)

onMounted(async () => {
    if (props.items) {
        statItems.value = props.items
        return
    }

    const res = await getStats()
    if (res.status == 200) {
        statItems.value = res.data.stats
        date.value = res.data.dates
    }
})

defineOptions({
    inheritAttrs: false,
})
</script>

<style lang="scss">
.statshead {
    display: grid;
    grid-template-columns: 1fr max-content;
    overflow-x: auto;
    gap: 1.5rem;
    // No left inset — the tiles start where the page's captions, cards and rows
    // start. Measured against the leading edge: 319px here against 303px for
    // the head and the chart rows on the stats page, and 315px on album/artist
    // (those two pages override the padding, see below). The tile carries its
    // own padding, so the container's was pure offset.
    padding: 1rem 1rem 1rem 0;

    // The stat cards scroll horizontally by touch/drag; never show the
    // scrollbar (it overlaps the cards on mobile — same treatment as the
    // genre banner next to it and the search tab chips).
    @include hideScrollbars;

    .left {
        display: flex;
        gap: 2rem;
    }

    .streamduration {
        padding: 1rem;
    }
}

.statsdates {
    // Same leading edge as the tiles above it — the caption's own chip padding
    // carries the air (styling.md, "Der Sticker fluchtet links").
    padding: 1rem 1rem 1rem 0;
    text-transform: uppercase;
    font-size: 0.75rem;
    font-weight: 900;

    // The caption rides a STICKER (#468) — same call as the scrobble summary
    // under the charts. Both were the last captions left bare on the doodled
    // ground; #404 plated every other one. The inner wrapper exists so the
    // plate is as wide as the text, not as wide as the page.
    .date {
        @include mem-sticker($pad: 0.35rem 0.75rem);
        display: inline-flex;
        align-items: center;
        gap: $small;

        svg {
            width: 1.25rem;
        }
    }
}
</style>
