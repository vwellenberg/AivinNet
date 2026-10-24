<template>
    <!-- The way to Rewind (#527), kept for good at the foot of the stats page
         (#572): the latest finished year, seen or not. What announces a new
         Rewind is Home's January card; this is where it stays afterwards. -->
    <RouterLink v-if="year" class="rewind-link" :to="{ name: Routes.Rewind, params: { year } }">
        Your {{ year }} Rewind
    </RouterLink>
</template>

<script setup lang="ts">
import { Routes } from '@/router'

defineProps<{ year: number | null | undefined }>()
</script>

<style lang="scss" scoped>
.rewind-link {
    @include btn-pill;
    // A pill, not a bar: the page's column would stretch it across the width.
    width: fit-content;
    // Under the calendar, as far from it as the calendar is from the tiles.
    margin-top: 2rem;
}
</style>
