<template>
    <div class="stats-charts">
        <GenericHeader>
            <template #name>Charts</template>
            <template #description>Your top artists, albums, tracks, and playlists</template>
        </GenericHeader>
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
        // Was a `<br>` between the head and the grid: one line-height (21px)
        // on the desktop — and the same 21px on a phone, where the head is
        // empty and the tabs should start at $phone-page-start like every
        // other page (they sat at 49px).
        margin-top: 1.25rem;
        display: grid;
        // `minmax(0, 1fr)`, not `1fr`: a grid item's automatic minimum is its
        // MIN-CONTENT, so the group grew to whatever its widest child needed
        // and took the page with it — measured at 320px, a 308px tab plate in
        // a 258px track, everything under it cut off at the screen edge. The
        // tabs scroll now (mem-seg-scroll); the track is what decides the
        // width. The chart rows fit: their min-content is 257px.
        grid-template-columns: minmax(0, 1fr);
        gap: 3rem;

        @include allPhones {
            margin-top: 0;
        }
    }
}
</style>
