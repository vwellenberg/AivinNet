<template>
    <div class="artist-top-tracks">
        <!-- The same head as a card row (CardScroller): the caption is the
             sticker and a link, SEE ALL stands apart at the right edge. It was
             one sticker with SEE ALL inside it, next to card rows whose pill
             sat on the far right — two heads on one page (user, 2026-10-06). -->
        <div class="tt-head" :class="{ 'has-route': !!route }">
            <h3 class="section-title" :class="{ isSmall, isMedium }">
                <RouterLink v-if="route" :to="route">{{ title }}</RouterLink>
                <template v-else>{{ title }}</template>
            </h3>
            <SeeAll :route="route" />
        </div>
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
    .tt-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $small;
    }

    .section-title {
        @include mem-sticker;
        margin-left: 0;
        font-size: 1.15rem;
        font-weight: 700;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    // A linked caption carries the hatch as a ring, like CardScroller's.
    .tt-head.has-route .section-title {
        padding-block: 0.5rem;
        @include mem-label-hatch(26px, $on: surface, $ring-x: 0.375rem, $ring-y: 0.3rem);
    }

    // A list of tracks names its type in colour, like a card row of one type
    // (CardScroller `row-is-*`). After the hatch rule: the static pastel wants
    // the accent strokes in both themes.
    .tt-head .section-title {
        @include mem-entity-tint(track);
        --label-hatch: var(--mem-hatch-accent);
    }

    .error {
        padding-left: 1rem;
        // "No tracks" fallback sits on the page ground -> theme-aware muted.
        color: $mem-content-muted;
    }

    h3 {
        // No padding of its own: on a sticker the horizontal padding IS the
        // chip, and these overrides (1rem left, $small right, both older than
        // the sticker) made it lopsided — measured 16px left against 8px right
        // on Favorites, 16 against 11.2 on an artist page. `mem-sticker` sets
        // both sides; the caption keeps them.
    }
}
</style>
