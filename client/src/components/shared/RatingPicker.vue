<template>
    <!-- The panel is often a child of a track row: a double-click in it must not
         reach the row (which plays on double-click). -->
    <div class="rating-picker rounded shadow-lg" role="dialog" aria-label="Rate track" @dblclick.stop>
        <RatingStars :value="value" @pick="emit('pick', $event)" />
        <button v-if="value !== null" type="button" class="btn-pill rating-clear" @click.stop="emit('pick', null)">
            Remove rating
        </button>
    </div>
</template>

<script setup lang="ts">
import RatingStars from './RatingStars.vue'

/**
 * The rating panel (#777): five large stars and, for a rated track, "Remove
 * rating". It only shows and emits — WHERE it opens and what a pick writes is
 * the host's business, because the hosts differ there: the song row hangs it
 * under its "★ 4" (TrackRating.vue), the player bar floats it above the heart
 * (RatableHeart.vue). Both write through the same `ratings.rate`, so one panel
 * and one store action serve every way into a rating.
 *
 * `pick` carries 1-5, or null for "clear" — from the button, or from tapping the
 * star the track already has (RatingStars).
 */
defineProps<{
    value: number | null
}>()

const emit = defineEmits<{
    (e: 'pick', rating: number | null): void
}>()
</script>

<style lang="scss">
// The panel's look only. Its position belongs to the host: absolute under the
// row's button in TrackRating.vue, a fixed popper above the bar's heart in
// RatableHeart.vue.
.rating-picker {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background-color: $mem-panel;
    border: $candy-border solid $mem-line;
    border-radius: $candy-radius-sm;
}
</style>
