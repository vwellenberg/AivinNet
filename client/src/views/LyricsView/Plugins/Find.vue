<template>
  <button
    type="button"
    class="pluginfindlyricsbtn"
    :class="{ showError: plugin.error }"
    @click="!plugin.error ? plugin.searchLyrics() : null"
  >
    <span v-if="plugin.error" class="text">{{ plugin.error }}</span>
    <span v-else-if="plugin.loading" class="text">Searching...</span>
    <span v-else class="text">Search online</span>
    <span v-if="plugin.loading" class="spinner"></span>
  </button>
</template>

<script setup lang="ts">
import useLyricsPlugin from "@/stores/plugins/lyrics";

const plugin = useLyricsPlugin();
</script>

<style lang="scss">
.pluginfindlyricsbtn {
  // The action on the empty state is a primary CTA, so it takes the role
  // instead of hand-writing a surface ($white/$black are the legacy aliases
  // this file still carried, and they point at theme vars now — the label was
  // the same colour as the fill in one of the two themes).
  //
  // The label needs `.text`: the role's sprinkle is an absolutely positioned
  // ::before, and the mixin only lifts `svg, .text` above it. A bare <span>
  // would sit UNDER the texture — the one thing the hatch rule forbids.
  @include btn-primary($h: auto);
  min-height: 2.75rem;
  margin-top: $medium;
  padding: $small 1.25rem;

  // The error state is a MESSAGE wearing the plate, not a button — it is not
  // clickable, so it must not answer the pointer either. Taking the role back
  // means all three of its pointer moves: the contrast fill (with the hatch it
  // brings, which would then run behind this text), the label flip, and the
  // scale. Not `disabled`: that dims the plate to 0.5 and the message with it.
  &.showError {
    background-color: $mem-coral;
    cursor: default;

    &:hover,
    &:active {
      background-color: $mem-coral;
      background-image: none;
      color: $mem-ink;
      transform: none;
      @include candy-shadow(3px, 3px);

      &::before {
        opacity: 0.45;
      }
    }
  }

  .spinner {
    position: relative;
    z-index: 1;
    margin-left: $medium;
    height: 1rem;
    width: 1rem;
  }
}
</style>
