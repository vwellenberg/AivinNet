<template>
  <div class="playlistcardgroup">
    <h3><component :is="icon" v-if="icon" class="caption-icon" aria-hidden="true" />{{ title }}</h3>
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
import type { Component } from "vue";
import { Playlist } from "@/interfaces";

withDefaults(
  defineProps<{
    playlists?: Playlist[];
    title: string;
    // A glyph drawn before the title, in the caption's own colour.
    icon?: Component;
  }>(),
  { playlists: () => [], icon: undefined }
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
    // Inline-flex keeps the sticker fitted to its content (the icon and the
    // title share a row); a caption without an icon lays out the same way.
    display: inline-flex;
    align-items: center;
    gap: $small;
  }

  // Sized like the sidebar's pin (`$glyph-lone`). Coloured by `color`, never
  // rotated: the pin is drawn on the diagonal already (sidebarPinTilt.test.ts).
  .caption-icon {
    width: $glyph-lone;
    height: $glyph-lone;
    flex: none;
  }
}
</style>
