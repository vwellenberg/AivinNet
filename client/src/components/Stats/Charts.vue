<template>
    <div class="stats-charts">
        <GenericHeader>
            <template #name>Charts</template>
            <template #description>Your top artists, albums, tracks, and playlists</template>
        </GenericHeader>
        <br>
        <div class="chartitemgroupsgrid">
            <ChartItemGroup />
        </div>
    </div>
</template>

<script setup lang="ts">
import GenericHeader from '@/components/shared/GenericHeader.vue'
import ChartItemGroup from './ChartItemGroup.vue'
</script>

<style lang="scss">
.stats-charts {
    .chartitemgroupsgrid {
        display: grid;
        // `minmax(0, 1fr)`, not `1fr`: a grid item's automatic minimum is its
        // MIN-CONTENT, so the group grew to whatever its widest child needed
        // and took the page with it — measured at 320px, a 308px tab plate in
        // a 258px track, everything under it cut off at the screen edge. The
        // tabs scroll now (mem-seg-scroll); the track is what decides the
        // width. The chart rows fit: their min-content is 257px.
        grid-template-columns: minmax(0, 1fr);
        gap: 3rem;
    }
}
</style>
