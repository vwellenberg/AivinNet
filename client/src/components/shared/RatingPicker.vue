<template>
    <!-- The panel is often a child of a track row: a double-click in it must not
         reach the row (which plays on double-click). -->
    <div class="rating-picker rounded shadow-lg" role="dialog" aria-label="Rate track" @dblclick.stop @keydown="onKeyDown">
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

// The keys the panel owns while focus is in it. Without this they bubble to the
// player's shortcuts on `window` (helpers/useKeyboard.ts): an arrow skipped to
// the next song (whose track change closed the bar's picker), and Space paused
// instead of rating, because a star focused right after a right-click counts as
// pointer focus there (utils/keyOwnership.ts). Escape still bubbles: the host
// closes on it.
const MOVES: Record<string, (i: number, last: number) => number> = {
    ArrowLeft: i => Math.max(0, i - 1),
    ArrowUp: i => Math.max(0, i - 1),
    ArrowRight: (i, last) => Math.min(last, i + 1),
    ArrowDown: (i, last) => Math.min(last, i + 1),
    Home: () => 0,
    End: (_, last) => last,
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ' || e.key === 'Enter') {
        // The focused button's own activation still runs; only the shortcut must not.
        e.stopPropagation()
        return
    }
    const move = MOVES[e.key]
    if (!move) return
    e.preventDefault()
    e.stopPropagation()
    const panel = e.currentTarget as HTMLElement
    const controls = Array.from(panel.querySelectorAll<HTMLElement>('button'))
    if (!controls.length) return
    const at = controls.indexOf(document.activeElement as HTMLElement)
    controls[move(at < 0 ? 0 : at, controls.length - 1)].focus()
}
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
