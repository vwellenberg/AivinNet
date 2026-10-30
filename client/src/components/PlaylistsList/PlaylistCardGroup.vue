<template>
  <div class="playlistcardgroup">
    <h3>{{ title }}</h3>
    <div class="grid">
      <!-- The tiles default to the playlists given; a section of another kind
           of tile (smart playlists, #642) passes its own through the slot, and
           gets this caption and grid for free. -->
      <slot>
        <PlaylistCard v-for="p in playlists" :key="p.id" :playlist="p" />
      </slot>
    </div>
  </div>
</template>

<script setup lang="ts">
import PlaylistCard from "@/components/PlaylistsList/PlaylistCard.vue";
import { Playlist } from "@/interfaces";

withDefaults(
  defineProps<{
    playlists?: Playlist[];
    title: string;
  }>(),
  { playlists: () => [] }
);
</script>

<style lang="scss">
.playlistcardgroup {
  // The same section rhythm as CardScroller's rows ($section-gap,
  // $section-caption-gap): Favorites and Playlists sit next to each other in
  // the navigation, and with 64px/8px here against 56px/24px there the tiles
  // jumped when switching between the two.
  margin-bottom: $section-gap;

  // "Pinned" / "All playlists" are section captions on the memphis ground, so
  // they are stickers like every other one.
  h3 {
    @include mem-sticker;
    // No left inset — the chip starts where the cards under it start (measured:
    // caption 315 against cards 303 before this). Same leftover as the Now
    // Playing captions: the gap a bare word needed to the page edge is the
    // sticker's own padding now. Found by the census in
    // sectionCaptionSticker.test.ts.
    margin: 0 0 $section-caption-gap;
    font-size: 1.15rem;
  }
}
</style>
