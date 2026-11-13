<template>
  <!-- Mondays: last week; on the 1st: last month (#530). The server decides
       whether there is a card; the card closes for its period. -->
  <section v-if="recap" class="recap-card" :class="`recap-${recap.kind}`" aria-label="Your recap">
    <button class="recap-open" @click="open">
      <span class="recap-lines">
        <span class="kicker">{{ lines.kicker }}</span>
        <span class="headline">{{ lines.headline }}</span>
        <span v-if="lines.detail" class="detail">{{ lines.detail }}</span>
      </span>
    </button>
    <button class="btn-quiet recap-close" aria-label="Dismiss recap" @click="dismiss">×</button>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'

import { dismissWeeklyRecap } from '@/requests/home'
import { Routes } from '@/router'
import useHome from '@/stores/home'
import useSettings from '@/stores/settings'
import { recapLines, recapStatsPeriod } from '@/utils/weeklyRecap'

const router = useRouter()
const settings = useSettings()
// The recap comes with Home's answer (#776): no request of its own, so the card
// is there with the rows, not after them.
const home = useHome()
const recap = computed(() => home.recap)
const lines = computed(() => (recap.value ? recapLines(recap.value) : { kicker: '', headline: '', detail: '' }))

// The card opens Stats on the period it tells about: the previous week or month,
// which the tabs reach as "last week" / "last month" (the period is the stats
// page's own setting). The current period would be empty on a Monday or the 1st.
function open() {
    if (!recap.value) return
    settings.setStatsPeriod(recapStatsPeriod(recap.value.kind))
    router.push({ name: Routes.Stats })
}

// Gone at once; the server keeps the answer, so it stays gone on the next Home.
function dismiss() {
    const closed = recap.value
    if (!closed) return
    home.clearRecap()
    void dismissWeeklyRecap(closed.key)
}
</script>

<style lang="scss">
// The Continue card's frame (HomeView/ContinueCard.vue): a candy plate in the
// panel colour with the dots on top, one line of kicker, headline and detail.
.recap-card {
    // Laid down like every plate on Home (ContinueCard.vue); alone, so no stagger.
    @include mem-arrival($steps: 0);
    position: relative;
    display: flex;
    align-items: stretch;
    margin-bottom: 2rem;
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius);
    @include candy-shadow(4px, 4px);
    // The panel's own text, not `$mem-ink`: ink does not change with the mode,
    // the panel does, and in dark mode the card was dark text on a dark plate
    // (user, 2026-11-01, "oben eine leere bar"). tests: panelText.test.ts
    color: $mem-text;

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
        // The base `button` centres its contents; the lines start top left.
        display: flex;
        align-items: flex-start;
        justify-content: flex-start;
        padding: 1rem 1.25rem;
        background: none;
        border: 0;
        color: inherit;
        text-align: left;
        cursor: pointer;
    }

    // The text veil sits on the LINES, not on the button. The button fills the
    // whole card, and the veil reaches 10–14 px past its host with a blur, so on
    // the button it lay over the card's own frame and shadow and turned them
    // whitish (user, 2026-11-02: "Rand ist auch weißlich, Bereich zu groß?").
    // On the lines it dims the dots around the words only, as on the Continue card.
    .recap-lines {
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 0.3rem;
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
