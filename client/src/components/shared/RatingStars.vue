<template>
    <div class="rating-stars" role="group" aria-label="Rating" @pointerleave="preview = null">
        <button
            v-for="n in 5"
            :key="n"
            type="button"
            class="btn-quiet rating-star"
            :class="{ filled: n <= shown }"
            :aria-label="`${n} of 5 stars`"
            :aria-pressed="value === n"
            :title="value === n ? 'Remove rating' : `${n} of 5 stars`"
            @pointerenter="onEnter($event, n)"
            @click.stop="pick(n)"
        >
            <StarFillSvg v-if="n <= shown" class="star-glyph" aria-hidden="true" />
            <StarSvg v-else class="star-glyph" aria-hidden="true" />
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import StarSvg from '@/assets/icons/star.svg'
import StarFillSvg from '@/assets/icons/star.fill.svg'

/**
 * Five large stars (44 px targets, styling.md "Touch-Ziele"). Picking the value
 * a track already has emits `null` — the same star again clears the rating.
 * The picker also offers an explicit "Remove rating" button for the same effect.
 *
 * Under a mouse the stars show what a click would set: the star under the
 * pointer and every one before it fill, the rest empty. That replaces the
 * role's hover plate, which lit ONE star white and said nothing about the
 * value (user, 2026-11-11).
 *
 * Mouse only, gated at the source like every hover (HOVER IS POINTER-ONLY,
 * _buttons.scss): a tap fires `pointerenter` too, and a preview latched by a
 * tap would keep showing the tapped value after it was cleared again.
 */
const props = defineProps<{
    value: number | null
}>()

const emit = defineEmits<{
    (e: 'pick', rating: number | null): void
}>()

const preview = ref<number | null>(null)

// What the stars show: the preview while the mouse is over them, else the value.
const shown = computed(() => preview.value ?? props.value ?? 0)

function onEnter(e: PointerEvent, n: number) {
    if (e.pointerType !== 'mouse') return
    preview.value = n
}

function pick(n: number) {
    preview.value = null
    emit('pick', props.value === n ? null : n)
}
</script>

<style lang="scss">
.rating-stars {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;

    .rating-star {
        // The role gives the 44 px box and the press.
        @include btn-quiet($size: 2.75rem, $glyph: 1.75rem);

        // Empty stars in the panel's glyph colour; set stars yellow — this
        // design's "active" — inside the SAME outline (star.fill.svg).
        .star-glyph {
            color: $mem-content-text;
        }

        &.filled .star-glyph {
            color: $mem-yellow;
            --star-edge: #{$mem-content-text};
        }

        // The preview IS the hover here, so the role's plate stays away: no
        // fill, no hatch. The role's hover text is the label for its contrast
        // plate, so with the plate gone the colour goes back to the panel's
        // (roleHoverGate.test.ts). The scale stays — it marks which star the
        // pointer is on.
        @media (hover: hover) {
            &:hover {
                background-color: transparent;
                background-image: none;
                color: $mem-content-text;
            }
        }
    }
}
</style>
