<template>
  <div class="switch rounded" :class="{ toggled: state }">
    <div class="circle circular"></div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  state: undefined | boolean;
}>();
</script>

<style lang="scss">
// The toggle is a raised control like every other one in this design: 3px ink
// frame and a hard offset shadow. It carried a 1px border and no shadow at all
// — the two things "es fehlen Schatten" pointed at, and the only 1px strokes
// left in this panel.
.switch {
  height: 1.875rem;
  width: 3.25rem;
  background-color: $candy-pink-soft;
  border: $candy-border-w solid $mem-line;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  @include candy-shadow(3px, 3px);
  // Motion only — the paint is a cut (styling.md). The knob still travels.
  transition: left 0.18s $motion-curve;

  .circle {
    transition: left 0.18s $motion-curve;
    height: 1.125rem;
    aspect-ratio: 1;
    // Static-white knob with a static ink ring: the knob rides ON the track
    // fill, so a paper (var) border would vanish in dark — keep it ink.
    background-color: $mem-panel-static;
    border: 2px solid $mem-ink;
    position: absolute;
    top: 50%;
    margin-top: -0.5625rem;
    left: 2px;
  }
}

.toggled {
  // Yellow means ON in this design, and the accent hatch says the surface is
  // pressable. No text rides on it, so the texture may cross the whole track.
  background-color: $mem-yellow;
  @include mem-hatch(26px, $on: accent);

  .circle {
    background-color: $mem-panel-static;
    left: calc(100% - 1.125rem - 2px);
  }
}
</style>
