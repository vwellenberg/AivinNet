<template>
  <!-- Mondays: last week; on the 1st: last month (#530). The server decides
       whether there is a card; the card closes for its period. -->
  <section v-if="recap" class="recap-card" :class="`recap-${recap.kind}`" aria-label="Your recap">
    <button class="recap-open" @click="open">
      <span class="kicker">{{ lines.kicker }}</span>
      <span class="headline">{{ lines.headline }}</span>
      <span v-if="lines.detail" class="detail">{{ lines.detail }}</span>
    </button>
    <button class="btn-quiet recap-close" aria-label="Dismiss recap" @click="dismiss">×</button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { dismissWeeklyRecap, getWeeklyRecap, type WeeklyRecap } from '@/requests/home'
import { Routes } from '@/router'
import useSettings from '@/stores/settings'
import { recapLines } from '@/utils/weeklyRecap'

const router = useRouter()
const settings = useSettings()
const recap = ref<WeeklyRecap | null>(null)
const lines = computed(() => (recap.value ? recapLines(recap.value) : { kicker: '', headline: '', detail: '' }))

onMounted(async () => {
    // Asked on every Home: the server answers `recap: null` on the days there
    // is no card, so a plain Home costs one answer and no listening history.
    const res = await getWeeklyRecap()
    recap.value = res.status === 200 ? (res.data?.recap ?? null) : null
})

// The card opens Stats on the period it tells about: the same tab the user
// would press by hand (the period is the stats page's own setting).
function open() {
    if (!recap.value) return
    settings.setStatsPeriod(recap.value.kind)
    router.push({ name: Routes.Stats })
}

// Gone at once; the server keeps the answer, so it stays gone on the next Home.
function dismiss() {
    const closed = recap.value
    if (!closed) return
    recap.value = null
    void dismissWeeklyRecap(closed.key)
}
</script>

<style lang="scss">
// The Continue card's frame (HomeView/ContinueCard.vue): a candy plate in the
// panel colour with the dots on top, one line of kicker, headline and detail.
.recap-card {
    position: relative;
    display: flex;
    align-items: stretch;
    margin-bottom: 2rem;
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius);
    @include candy-shadow(4px, 4px);
    color: $mem-ink;

    &::before {
        // The card sits on the panel (`--row-fill`), not on a pastel: dots in the
        // theme's own ink, as the sidebar plate has them.
        @include mem-halftone($reach: null, $on: surface);
    }

    > * {
        position: relative;
        z-index: 1;
    }

    .recap-open {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
        padding: 1rem 1.25rem;
        background: none;
        border: 0;
        color: inherit;
        text-align: left;
        cursor: pointer;
        @include mem-dots-veil;
    }

    .kicker {
        font-size: 0.7rem;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }

    .headline {
        font-size: 1.35rem;
        font-weight: 700;
    }

    .detail {
        font-size: 0.85rem;
    }

    // The glyph's role is `btn-quiet` (Global/_button-classes.scss): no plate
    // at rest, a 44-px target, the hover from the role.
    .recap-close {
        align-self: flex-start;
        font-size: 1.4rem;
        line-height: 1;
    }
}
</style>
