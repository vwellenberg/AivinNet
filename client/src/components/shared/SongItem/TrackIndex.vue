<template>
  <div
    class="index t-center ellip"
    @dblclick.prevent.stop="() => {}"
  >
    <div v-if="is_current" class="now-playing-meter">
      <PlayingMeter :playing="is_current_playing" />
    </div>
    <div v-else class="text">
      {{ index }}
    </div>
  </div>
</template>

<script setup lang="ts">
import PlayingMeter from '@/components/shared/PlayingMeter.vue';

defineProps<{
  index: number | string;
  is_current?: boolean;
  is_current_playing?: boolean;
}>();
</script>

<style lang="scss">
.songlist-item > .index {
  font-size: 0.8rem;
  width: 100%;
  position: relative;
  height: 3rem;
  display: flex;
  justify-content: center;
  align-items: center;

  // The number sits in a stamped ink circle — the ticket number of the cassette
  // inlay this list is built as, next to the guide band and the glued cover.
  //
  // It is no longer dimmed with `opacity`. On a bordered disc that fades the
  // ring along with the numeral, and a half-strength ring beside a full-strength
  // one reads as a broken row rather than a quiet one — the same finding the
  // sidebar glyphs produced (.claude/rules/styling.md: opacity on a glyph is a
  // state, not decoration). The number is quiet because it is small.
  //
  // No transition: the number is not animated into anything. It is swapped for
  // the meter by `v-if`, and a node that enters the DOM has no previous value
  // to travel from. Measured on a hovered row: nothing on `.text` changes.
  .text {
    display: flex;
    align-items: center;
    justify-content: center;
    // Fixed box, not a padded one: the disc has to stay round from "1" to
    // "999", and `flex-shrink: 0` keeps the grid cell from squeezing it oval.
    width: $index-badge;
    height: $index-badge;
    flex-shrink: 0;
    border: 2px solid currentColor;
    border-radius: 50%;
    font-size: 0.76rem;
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    // ⚠️ A four-digit ordinal does not fit: 23px of inner width against ~7.3px
    // per tabular digit. Playlists that long exist, and without this the numeral
    // would break OUT of the disc and run under the cover instead of the disc
    // simply cropping it. Clipping inside the badge keeps the list's rhythm;
    // breaking out of it does not.
    overflow: hidden;
  }

  // Now-playing meter shown in place of the track number (#67, redrawn in #357).
  // Animation, geometry and the paused state all live in PlayingMeter.vue.
  .now-playing-meter {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: 100%;

    // This row is always `.songlist-item.current`, i.e. $mem-yellow. Measured
    // against that fill, $mem-coral is 1.98:1 and misses the 3:1 WCAG 1.4.11
    // floor for graphics, so the peak drops back to the row ink (9.64:1). The
    // accent lives where it reads: on the dark player bar.
    --meter-peak: currentColor;
  }

  // NOTE: A `.heart-icon` block used to sit here, from when the favourite
  // marker lived next to the track number. It moved to the duration column
  // long ago — the element this styled never appears inside `.index`, so the
  // rules (including a `transition: all`) applied to nothing. The live one is
  // in TrackDuration.vue; do not restore a second copy here.
}
</style>
