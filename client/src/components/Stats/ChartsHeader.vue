<template>
    <div class="chartheader">
        <!-- Each plate keeps its own size and its own scroller: a tab group is
             its words, and four of them are 308px on a phone. Same box the
             discography tabs sit in (mem-seg-scroll). -->
        <div class="seg-scroll">
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
        <div class="seg-scroll">
            <div ref="periodSeg" class="seg" role="group" aria-label="Chart period">
                <button
                    v-for="p in periods"
                    :key="p"
                    type="button"
                    :class="{ active: p === period }"
                    :aria-pressed="p === period"
                    @click="$emit('changePeriod', p)"
                >
                    {{ p }}
                </button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue'

const props = defineProps<{
    name: string
    period: string
}>()

defineEmits<{
    (e: 'changePeriod', period: string): void
    (e: 'changeGroup', group: string): void
}>()

const groups = ['artists', 'albums', 'tracks', 'playlists']
const periods = ['week', 'month', 'year', 'alltime']

const groupSeg = ref<HTMLElement | null>(null)
const periodSeg = ref<HTMLElement | null>(null)

// A plate that scrolls can hold the selected tab off-screen — "playlists" and
// "alltime" are the last of their four, so the state the page opens in is
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
watch(() => props.period, () => nextTick(() => revealActive(periodSeg.value)))
</script>

<style lang="scss">
.chartheader {
    padding: $smaller 0 1rem 0;
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

    // One segmented plate per tab group — the anatomy itself lives in
    // `mem-seg-tabs` (_candy.scss), shared with the discography tabs. The box
    // it scrolls in is `mem-seg-scroll`, shared with the same page.
    .seg-scroll {
        @include mem-seg-scroll;
        // The shadow reserve lives INSIDE the scroll port, so on a
        // `space-between` row it would hold the right-hand plate off the row's
        // right edge — the edge #555 aligned, and the one the trend sticker
        // below it answers to. Pulled back out of the layout; the reserve
        // still travels with the scroll.
        //
        // Reads the TOKEN, not a literal: this cancels exactly what the mixin
        // books, and a hand-written `-4px` would keep pointing at the old
        // number the day the default moves. `leadingEdge.test.ts` watches the
        // left side only, so the right one is on this file.
        margin-right: -$mem-seg-reserve;
    }

    .seg {
        @include mem-seg-tabs;
    }
}
</style>
