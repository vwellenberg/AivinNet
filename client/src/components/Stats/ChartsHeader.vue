<template>
    <div class="chartheader">
        <!-- Each plate keeps its own size and its own scroller: a tab group is
             its words, and four of them are 308px on a phone. Same box the
             discography tabs sit in (mem-seg-scroll). Where a plate is wider
             than the screen, the cut-off edge fades and carries an arrow, like
             the stat tiles below (mem-edge-fade). -->
        <div class="seg-row">
            <button
                v-if="groupEdges.canPrev.value"
                type="button"
                class="segnav prev"
                aria-label="Scroll chart types left"
                @click="groupEdges.page(-1)"
            >
                <RightArrowSvg />
            </button>
            <div
                ref="groupScroll"
                class="seg-scroll"
                :class="{ 'has-prev': groupEdges.canPrev.value, 'has-next': groupEdges.canNext.value }"
                @scroll.passive="groupEdges.sync"
            >
                <div ref="groupSeg" class="seg" role="group" aria-label="Chart type">
                    <button
                        v-for="g in groups"
                        :key="g"
                        type="button"
                        :class="{ active: g === name }"
                        :aria-pressed="g === name"
                        @click="$emit('changeGroup', g)"
                    >
                        {{ g }}
                    </button>
                </div>
            </div>
            <button
                v-if="groupEdges.canNext.value"
                type="button"
                class="segnav next"
                aria-label="Scroll chart types right"
                @click="groupEdges.page(1)"
            >
                <RightArrowSvg />
            </button>
        </div>
        <div class="seg-row">
            <button
                v-if="periodEdges.canPrev.value"
                type="button"
                class="segnav prev"
                aria-label="Scroll periods left"
                @click="periodEdges.page(-1)"
            >
                <RightArrowSvg />
            </button>
            <div
                ref="periodScroll"
                class="seg-scroll"
                :class="{ 'has-prev': periodEdges.canPrev.value, 'has-next': periodEdges.canNext.value }"
                @scroll.passive="periodEdges.sync"
            >
                <div ref="periodSeg" class="seg" role="group" aria-label="Chart period">
                    <button
                        v-for="p in periods"
                        :key="p"
                        type="button"
                        :class="{ active: p === period }"
                        :aria-pressed="p === period"
                        @click="$emit('changePeriod', p)"
                    >
                        {{ statsPeriodLabel(p) }}
                    </button>
                </div>
            </div>
            <button
                v-if="periodEdges.canNext.value"
                type="button"
                class="segnav next"
                aria-label="Scroll periods right"
                @click="periodEdges.page(1)"
            >
                <RightArrowSvg />
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

import RightArrowSvg from '@/assets/icons/right-arrow.svg'
import useScrollEdges from '@/composables/useScrollEdges'

import { STATS_TABS, isStatsPeriod, isStatsTab, statsPeriodLabel } from '@/utils/statsPeriod'

const props = defineProps<{
    name: string
    period: string
}>()

defineEmits<{
    (e: 'changePeriod', period: string): void
    (e: 'changeGroup', group: string): void
}>()

const groups = ['artists', 'albums', 'tracks', 'playlists']
// The tab row, plus the current period as an extra active tab when it is not
// one of the tabs (arriving from the recap card on "last week" / "last month").
// Picking another tab changes the period, and the extra tab goes with it.
const periods = computed<readonly string[]>(() =>
    isStatsPeriod(props.period) && !isStatsTab(props.period) ? [...STATS_TABS, props.period] : [...STATS_TABS]
)

const groupSeg = ref<HTMLElement | null>(null)
const periodSeg = ref<HTMLElement | null>(null)
const groupScroll = ref<HTMLElement | null>(null)
const periodScroll = ref<HTMLElement | null>(null)
const groupEdges = useScrollEdges(groupScroll)
const periodEdges = useScrollEdges(periodScroll)

// A plate that scrolls can hold the selected tab off-screen — "playlists" and
// "alltime" are the last of their plates, so the state the page opens in is
// exactly the one a phone would not show. The scroller is the plate's PARENT,
// so `scrollIntoView` on the button moves the right box.
//
// `block: 'nearest'` matters: the default scrolls the PAGE vertically too, and
// landing on /stats would jump past the header.
function revealActive(seg: HTMLElement | null) {
    const active = seg?.querySelector('button.active')
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}

onMounted(() => nextTick(() => {
    revealActive(groupSeg.value)
    revealActive(periodSeg.value)
}))

watch(() => props.name, () => nextTick(() => revealActive(groupSeg.value)))
// A recap period adds a sixth tab, so the plate's width changes with it.
watch(() => props.period, () => nextTick(() => {
    revealActive(periodSeg.value)
    periodEdges.sync()
}))
</script>

<style lang="scss">
.chartheader {
    // The first thing on the stats page, in every layout: nothing above the
    // tabs, so they start where every other page's first element does. The
    // $smaller it had on the phone put them 4px below Favorites.
    padding: 0 0 1rem 0;
    // No horizontal inset, same call as the group's other non-row children in
    // #555: the tabs are a plate with their own padding, and they line up with
    // the page title above and the chart rows below. It sat 16px inside both.
    // `space-between` means the margin missed the period tabs on the right by
    // the same amount.
    display: flex;
    justify-content: space-between;
    align-items: center;
    flex-wrap: wrap;
    gap: $small;

    // The box the arrows sit over, and the header's flex item: it shrinks
    // below its plate (min-width: 0) and its scroller scrolls the rest.
    .seg-row {
        position: relative;
        display: flex;
        min-width: 0;
        max-width: 100%;
        // The shadow reserve lives INSIDE the scroll port, so on a
        // `space-between` row it would hold the right-hand plate off the row's
        // right edge — the edge #555 aligned, and the one the trend sticker
        // below it answers to. Pulled back out of the layout; the reserve
        // still travels with the scroll.
        //
        // On the ROW, not the scroller inside it: there the scroller's
        // `max-width: 100%` reads the row, which the same margin had already
        // shrunk — every plate reported 4px of overflow and an arrow it did
        // not need (measured at 390px).
        //
        // Reads the TOKEN, not a literal: this cancels exactly what the mixin
        // books, and a hand-written `-4px` would keep pointing at the old
        // number the day the default moves. `leadingEdge.test.ts` watches the
        // left side only, so the right one is on this file.
        margin-right: -$mem-seg-reserve;
    }

    .segnav {
        // Smaller than the tiles' arrow: it sits over a 46px plate, not a
        // 192px tile. Centred on the plate, not on the shadow reserve below it.
        @include mem-edge-arrow($size: 2.25rem, $inset: 0);
        bottom: $mem-seg-reserve;
    }

    // One segmented plate per tab group — the anatomy itself lives in
    // `mem-seg-tabs` (_candy.scss), shared with the discography tabs. The box
    // it scrolls in is `mem-seg-scroll`, shared with the same page.
    .seg-scroll {
        @include mem-seg-scroll;
        @include mem-edge-fade;
        // `revealActive` scrolls the selected tab clear of the arrow, not
        // under it.
        scroll-padding-inline: 2.75rem;
    }

    .seg {
        @include mem-seg-tabs;
    }
}
</style>
