<template>
    <div class="artist-top-tracks">
        <h3 class="section-title" :class="{ isSmall, isMedium }">
            {{ title }}
            <SeeAll :route="route" />
        </h3>
        <div class="tracks" :class="{ isSmall, isMedium }">
            <SongItem
                v-for="(song, index) in tracks"
                :key="index"
                :track="song"
                :index="total ? total - index : index + 1"
                :is_first="index === 0"
                :is_last="index === tracks.length - 1"
                :band_fade="trackBandFade(index + 1, tracks.length)"
                :source="source"
                :show_plays="show_plays"
                @playThis="playHandler(index)"
            />
        </div>
        <div v-if="!tracks.length" class="error">No tracks</div>
    </div>
</template>

<script setup lang="ts">
import { dropSources } from '@/enums'
import { Track } from '@/interfaces'
import { isMedium, isSmall } from '@/stores/content-width'
import SeeAll from '../shared/SeeAll.vue'
import SongItem from '../shared/SongItem.vue'
import { trackBandFade } from '@/utils/songItemMethods'

defineProps<{
    tracks: Track[]
    route: string
    title: string
    playHandler: (index: number) => void
    source: dropSources
    total?: number
    show_plays?: boolean
}>()
</script>

<style lang="scss">
.artist-top-tracks {
    padding-top: 1rem;

    // A section caption on the memphis ground — sticker, like the row captions
    // on home and the page titles.
    .section-title {
        @include mem-sticker;
        margin-left: 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .error {
        padding-left: 1rem;
        // "No tracks" fallback sits on the page ground -> theme-aware muted.
        color: $mem-content-muted;
    }

    h3 {
        display: flex;
        justify-content: space-between;
        // No padding of its own: on a sticker the horizontal padding IS the
        // chip, and these overrides (1rem left, $small right, both older than
        // the sticker) made it lopsided — measured 16px left against 8px right
        // on Favorites, 16 against 11.2 on an artist page. `mem-sticker` sets
        // both sides; the caption keeps them.
    }
}
</style>
