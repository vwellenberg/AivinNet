<template>
    <!-- January only (#572): the year that ended has a Rewind, and the user has
         not seen it to the end yet. Seen, it goes, and stays on the stats
         page's calendar as a door until next January. -->
    <section v-if="year" ref="card" class="rewind-card" :aria-label="`Your ${year} Rewind`">
        <div class="rewind-card-text">
            <h2 class="rewind-card-title">Your {{ year }} Rewind</h2>
            <p class="rewind-card-sub">A year of your listening, told in a few plates.</p>
        </div>
        <RouterLink class="rewind-card-open" :to="{ name: Routes.Rewind, params: { year } }">
            Open
        </RouterLink>
    </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { Routes } from '@/router'
import useHome from '@/stores/home'
import { celebrate } from '@/utils/confetti'
import { announcedOnHome, newYearBurst } from '@/utils/rewind'

// The years come with Home's own answer (#776), so the card stands there with
// the rows instead of dropping in above them a request later. It shows in
// January only (`announcedOnHome`).
const home = useHome()
const year = computed(() => announcedOnHome(home.rewind?.fresh))
const card = ref<HTMLElement | null>(null)

// Happy New Year: the first time the card shows on this device, a burst of
// confetti out of it — once per year, not on every visit to Home. Immediate:
// on a return to Home the store already holds the years when the card mounts.
watch(
    year,
    async y => {
        if (!y || !newYearBurst(y)) return
        await nextTick()
        const box = card.value?.getBoundingClientRect()
        celebrate(40, box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : undefined)
    },
    { immediate: true },
)
</script>

<style lang="scss">
// A reading plate on the ground (styling.md, `--mem-veil`): the plate is not
// pressable, its one button is.
.rewind-card {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    margin-bottom: 2rem;
    padding: 1rem 1.25rem;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow(4px, 4px);
    color: $mem-content-text;

    .rewind-card-title {
        @include mem-sticker;
        margin: 0 0 0.5rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .rewind-card-sub {
        margin: 0;
        color: $mem-content-faint;
    }

    .rewind-card-open {
        @include btn-primary;
    }
}
</style>
