<template>
    <!-- The way to Rewind (#527), kept for good at the foot of the stats page
         (#572): the latest finished year, seen or not. What announces a new
         Rewind is Home's January card; this is where it stays afterwards.
         A section like the others above it, with its own sticker heading. -->
    <section v-if="year" class="rewind-section">
        <h3 class="section-title">Rewind</h3>
        <div class="rewind-plate">
            <p class="rewind-blurb">Your year in music, played back: top tracks, artists and your biggest day.</p>
            <RouterLink class="rewind-link" :to="{ name: Routes.Rewind, params: { year } }">
                Your {{ year }} Rewind
            </RouterLink>
        </div>
    </section>
</template>

<script setup lang="ts">
import { Routes } from '@/router'

defineProps<{ year: number | null | undefined }>()
</script>

<style lang="scss" scoped>
.rewind-section {
    // Under the calendar and the records, as far from them as they are from each other.
    margin-top: 2rem;
}

.section-title {
    @include mem-sticker;
    margin: 0 0 1rem 0;
    font-size: 1.15rem;
    font-weight: 700;
}

.rewind-plate {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem;
    background-color: var(--mem-veil);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-shadow;
    color: $mem-content-text;
}

.rewind-blurb {
    margin: 0;
    flex: 1 1 16rem;
}

.rewind-link {
    @include btn-pill;
    // A pill, not a bar: the plate's flex row would stretch it.
    width: fit-content;
}
</style>
