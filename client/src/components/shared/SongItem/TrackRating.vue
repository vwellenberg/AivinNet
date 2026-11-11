<template>
    <div ref="anchorRef" class="track-rating-anchor">
        <button
            type="button"
            class="track-rating"
            :class="{ rated: shown !== null, unrated: shown === null }"
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
            <StarSvg v-else class="track-rating-glyph" aria-hidden="true" />
        </button>

        <!-- The panel is a child of the row: a click or double-click in it must not
             reach the row (which plays on double-click). -->
        <div
            v-if="showPicker"
            class="rating-picker rounded shadow-lg"
            role="dialog"
            aria-label="Rate track"
            @dblclick.stop
        >
            <RatingStars :value="shown" @pick="onPick" />
            <button
                v-if="shown !== null"
                type="button"
                class="btn-pill rating-clear"
                @click.stop="onPick(null)"
            >
                Remove rating
            </button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { onClickOutside } from '@vueuse/core'

import StarSvg from '@/assets/icons/star.svg'
import StarFillSvg from '@/assets/icons/star.fill.svg'
import RatingStars from '../RatingStars.vue'
import useRatings from '@/stores/ratings'

/**
 * The row's rating (#777): a quiet "★ 4" for a rated track, a hollow star
 * under the pointer for an unrated one, nothing on phones. Tapping or clicking it opens a
 * picker with five large stars and a "remove" button. The picker is the same
 * pattern as the sort DropDown: a boolean, `onClickOutside` to close.
 *
 * The hollow star is only visible on pointer devices — that gate lives in the
 * stylesheet below (`@media (hover: hover)`).
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

// In the row the rating is a quiet value in its own fixed slot, not a sticker
// (#777, second round). The sticker pill with its ring and offset shadow read
// as a fourth badge beside heart, duration pill and ⋯, and squeezed the row:
// the last column was sized for three controls, so the group spilled left onto
// the date ("4 minutes ago★ 5"). The slot is reserved in the column width
// ($songlist-rating-slot inside $songlist-duration-col) and keeps the duration
// at the same x-position whether a row is rated or not.
.songlist-item > .options-and-duration .track-rating-anchor {
    width: $songlist-rating-slot;
    justify-content: center;

    // Phones rate from the ⋯ menu ("Rate ›") and the Now Playing stars: a value
    // in every row was one item too many on a 390px row (user, 2026-11-11).
    @include allPhones {
        display: none;
    }
}

.songlist-item > .options-and-duration .track-rating {
    @include btn-quiet($size: $control-compact, $width: $songlist-rating-slot, $glyph: 0.85rem);
    gap: 0.15rem;
    font-size: small;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
    // The row's colour, like the ⋯ beside it: every filled state (playing,
    // context menu, hovered) pins the row text, and the value follows it.
    color: inherit;

    .track-rating-glyph {
        color: currentColor;
    }
}

// Unrated: nothing in the row at rest. Under the pointer a hollow star shows
// where the value would be, gated at the source like the other row hovers
// (styling.md "Ein Zeilen-Hover wird an der QUELLE gegatet").
.songlist-item > .options-and-duration .track-rating.unrated {
    visibility: hidden;
    opacity: 0.6;
}

@media (hover: hover) {
    .songlist-item:hover > .options-and-duration .track-rating.unrated {
        visibility: visible;
    }
}

// The row with an open picker paints above its neighbours: the rows are
// positioned siblings, and the next one would otherwise cover the picker.
.songlist-item:has(.rating-picker),
.vue-recycle-scroller__item-view:has(.rating-picker) {
    z-index: 40;
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
