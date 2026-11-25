<template>
    <!-- ONE row. Upstream split it into "all but the last" and "the last", the
        last pinned to the far edge by a `1fr` column — a place of honour for
        whatever the backend happens to send last: the library count on /stats,
        completeness on an album, top album on an artist. None of them is set
        apart by meaning, so on a wide window the split just read as a tile
        that drifted away from its row. -->
    <div class="statsrow" v-if="statItems.length">
        <button
            v-if="canPrev"
            type="button"
            class="statsnav prev"
            aria-label="Scroll left"
            @click="page(-1)"
        >
            <RightArrowSvg />
        </button>
        <div
            ref="row"
            class="statshead"
            :class="{ 'has-prev': canPrev, 'has-next': canNext }"
            @scroll.passive="syncEdges"
        >
            <StatItem
                v-for="item in statItems"
                :key="item.cssclass"
                :value="item.value"
                :text="item.text"
                :icon="item.cssclass"
                :image="item.image"
                :trackhash="item.trackhash"
                :detail="item.detail"
                :expandable="opens(item)"
                :expanded="opens(item) && showDiscoveries"
                :controls="opens(item) ? 'stats-discoveries' : undefined"
                @toggle="showDiscoveries = !showDiscoveries"
            />
        </div>
        <button
            v-if="canNext"
            type="button"
            class="statsnav next"
            aria-label="Scroll right"
            @click="page(1)"
        >
            <RightArrowSvg />
        </button>
    </div>
    <div class="statsdates" v-if="date">
        <div class="date">
            <CalendarSvg />
            {{ date }}
        </div>
    </div>
    <Discoveries v-if="showDiscoveries && props.period" id="stats-discoveries" :period="props.period" />
</template>

<script setup lang="ts">
import { getStats } from '@/requests/stats'
import { nextTick, ref, watch } from 'vue'
import useScrollEdges from '@/composables/useScrollEdges'
import StatItem from './StatItem.vue'
import Discoveries from './Discoveries.vue'
import CalendarSvg from '@/assets/icons/calendar.svg'
import RightArrowSvg from '@/assets/icons/right-arrow.svg'

interface StatItemData {
    cssclass: string
    value: string
    text: string
    image?: string
    trackhash?: string
    detail?: string | null
}

const props = defineProps<{
    items?: StatItemData[]
    /** The charts' period on the stats page (#523); without one the server answers for the week. */
    period?: string
}>()

const statItems = ref<StatItemData[]>([])

// The "new artists · new albums" tile opens the list of them (#539) — on the
// stats page, which knows the period; an album or artist page has no such tile.
const showDiscoveries = ref(false)
const opens = (item: StatItemData) => item.cssclass === 'discoveries' && !!props.period
const date = ref<string | null>(null)

// Quick period flips can overtake each other: only the newest answer may
// paint, or "Year" ends up showing the week that was still on its way.
let fetchSeq = 0

async function load() {
    if (props.items) {
        statItems.value = props.items
        return
    }

    const seq = ++fetchSeq
    const res = await getStats(props.period)
    if (seq !== fetchSeq) return

    // A failed request clears the row: the previous period's numbers under
    // the new period's tab would read as an answer.
    statItems.value = res.status == 200 ? res.data.stats : []
    date.value = res.status == 200 ? res.data.dates : null
}

watch(() => [props.period, props.items], load, { immediate: true })

// The row scrolls natively; arrows and fade only where there is more.
const row = ref<HTMLElement | null>(null)
const { canPrev, canNext, sync: syncEdges, page } = useScrollEdges(row)

// Later batches of tiles are measured after they render.
watch(statItems, () => nextTick(syncEdges))

defineOptions({
    inheritAttrs: false,
})
</script>

<style lang="scss">
.statsrow {
    position: relative;
}

// Arrows sit over the row's edges, so showing or hiding one never moves the
// tiles. They show on touch too (user, 2026-11-18): a swipe works there, but
// on a phone the cut-off tile at the edge read as a clipped layout rather
// than as "more this way", and the fade alone is a faint hint for that.
.statsnav {
    @include mem-edge-arrow;
}

.statshead {
    display: flex;
    overflow-x: auto;
    gap: 2rem;
    // Tiles land on their left edge when a swipe or arrow stops, not halfway
    // through one. `proximity` keeps free wheel scrolling between stops.
    scroll-snap-type: x proximity;

    // Fade the edge that still has tiles beyond it, so the cut-off reads as
    // "more this way" rather than as a clipped card.
    @include mem-edge-fade;

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

    // Scroll sideways on a narrow window rather than squeeze the tiles below
    // what their numbers need (the search page shows this same row).
    .statitem {
        flex-shrink: 0;
        scroll-snap-align: start;
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
