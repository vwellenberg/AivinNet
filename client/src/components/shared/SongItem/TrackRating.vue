<template>
    <div class="track-rating-anchor" ref="anchorRef">
        <button
            type="button"
            class="mem-sticker track-rating"
            :class="{ rated: shown !== null, unrated: shown === null, open: showPicker }"
            :aria-label="shown === null ? 'Rate track' : `Rated ${shown} of 5 — change rating`"
            :aria-expanded="showPicker"
            :title="shown === null ? 'Rate track' : `${shown} of 5 stars`"
            @click.stop="toggle"
            @dblclick.stop="() => {}"
        >
            <template v-if="shown !== null">
                <StarFillSvg class="track-rating-glyph" aria-hidden="true" />
                <span class="track-rating-value">{{ shown }}</span>
            </template>
            <template v-else>
                <span class="track-rating-value" aria-hidden="true">+</span>
            </template>
        </button>

        <div v-if="showPicker" class="rating-picker rounded shadow-lg" role="dialog" aria-label="Rate track">
            <RatingStars :value="shown" @pick="onPick" />
            <button
                v-if="shown !== null"
                type="button"
                class="btn-pill rating-clear"
                @click.stop="onPick(null)"
            >
                Bewertung entfernen
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'

import StarFillSvg from '@/assets/icons/star.fill.svg'
import RatingStars from '../RatingStars.vue'
import useRatings from '@/stores/ratings'

/**
 * The row's rating sticker (#777): "★ 4" for a rated track, a dashed ghost
 * ("+") under the pointer for an unrated one. Tapping or clicking it opens a
 * picker with five large stars and a "remove" button. The picker is the same
 * pattern as the sort DropDown: a boolean, `onClickOutside` to close.
 *
 * The ghost is only visible on pointer devices — that gate lives in the row's
 * stylesheet (`@media (hover: hover)`), not here.
 */
const props = defineProps<{
    trackhash: string
    rating: number | null
}>()

const ratings = useRatings()
const showPicker = ref(false)
const anchorRef = ref<HTMLElement>()

// The session's answer wins over the copy this row was loaded with.
const shown = computed<number | null>(() => ratings.rating(props.trackhash, props.rating ?? null))

function toggle() {
    showPicker.value = !showPicker.value
}

function onPick(rating: number | null) {
    showPicker.value = false
    ratings.rate(props.trackhash, rating, props.rating ?? null)
}

onClickOutside(anchorRef, () => {
    showPicker.value = false
})
</script>

<style lang="scss">
.track-rating-anchor {
    position: relative;
    display: inline-flex;
}

// The sticker is a caption-sized pill, like the duration beside it. The role
// class (mem-sticker) paints the shadow and the ring; the fill is set here.
.songlist-item > .options-and-duration .track-rating {
    // The role class paints the sticker: fill, ink text and the offset shadow.
    // The fill is a custom property so the yellow row can swap it (below).
    @include mem-sticker($radius: $candy-radius-pill, $pad: 0.1rem 0.5rem, $fill: var(--track-rating-fill, #{$mem-yellow}));
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    min-height: $control-compact;
    font-weight: 700;
    font-size: small;
    font-variant-numeric: tabular-nums;
    border: $mem-ring-w solid var(--look-badge-line, currentColor);
    cursor: pointer;

    .track-rating-glyph {
        width: 0.9rem;
        height: 0.9rem;
        color: currentColor;
    }
}

// Unrated: nothing in the row on touch. On pointer devices a dashed ghost
// shows under the pointer only, gated at the source like the other row hovers
// (styling.md "Ein Zeilen-Hover wird an der QUELLE gegatet").
.songlist-item > .options-and-duration .track-rating.unrated {
    visibility: hidden;
    background-color: transparent;
    border-style: dashed;
    color: $mem-content-muted;
    box-shadow: none;
}

@media (hover: hover) {
    .songlist-item:hover > .options-and-duration .track-rating.unrated {
        visibility: visible;
    }
}

// On the yellow now-playing row, yellow on yellow fails contrast (1,24:1):
// the rated sticker turns white with ink text there.
.songlist-item.current > .options-and-duration .track-rating {
    --track-rating-fill: #ffffff;
}

.songlist-item.current > .options-and-duration .track-rating.unrated {
    color: $mem-ink;
}

.rating-picker {
    position: absolute;
    top: calc(100% + 0.4rem);
    right: 0;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background-color: $mem-panel;
    border: $candy-border solid $mem-line;
    border-radius: $candy-radius-sm;
}
</style>
