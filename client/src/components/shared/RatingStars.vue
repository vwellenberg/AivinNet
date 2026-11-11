<template>
    <div class="rating-stars" role="group" aria-label="Rating">
        <button
            v-for="n in 5"
            :key="n"
            type="button"
            class="btn-quiet rating-star"
            :class="{ filled: n <= (value ?? 0) }"
            :aria-label="`${n} of 5 stars`"
            :aria-pressed="value === n"
            :title="value === n ? 'Remove rating' : `${n} of 5 stars`"
            @click.stop="pick(n)"
        >
            <StarFillSvg v-if="n <= (value ?? 0)" class="star-glyph" aria-hidden="true" />
            <StarSvg v-else class="star-glyph" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup lang="ts">
import StarSvg from '@/assets/icons/star.svg'
import StarFillSvg from '@/assets/icons/star.fill.svg'

/**
 * Five large stars (44 px targets, styling.md "Touch-Ziele"). Picking the value
 * a track already has emits `null` — the same star again clears the rating,
 * which is how Now Playing removes one without a second control. The picker
 * also offers an explicit "Remove rating" button for the same effect.
 */
const props = defineProps<{
    value: number | null
}>()

const emit = defineEmits<{
    (e: 'pick', rating: number | null): void
}>()

function pick(n: number) {
    emit('pick', props.value === n ? null : n)
}
</script>

<style lang="scss">
.rating-stars {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;

    .rating-star {
        // The role gives the 44 px box and the press; the star itself is the
        // glyph inside it, in the row's own colour (currentColor).
        @include btn-quiet($size: 2.75rem, $glyph: 1.75rem);

        .star-glyph {
            color: $mem-content-text;
        }
    }
}
</style>
