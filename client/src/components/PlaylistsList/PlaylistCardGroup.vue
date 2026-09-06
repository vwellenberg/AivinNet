<template>
  <div class="playlistcardgroup">
    <h3>{{ title }}</h3>
    <div class="grid">
      <PlaylistCard v-for="p in playlists" :key="p.id" :playlist="p" />
    </div>
  </div>
</template>

<script setup lang="ts">
import PlaylistCard from "@/components/PlaylistsList/PlaylistCard.vue";
import { Playlist } from "@/interfaces";

defineProps<{
  playlists: Playlist[];
  title: string;
}>();
</script>

<style lang="scss">
.playlistcardgroup {
  margin-bottom: 4rem;

  // "Pinned" / "All playlists" are section captions on the memphis ground, so
  // they are stickers like every other one.
  h3 {
    @include mem-sticker;
    // No left inset — the chip starts where the cards under it start (measured:
    // caption 315 against cards 303 before this). Same leftover as the Now
    // Playing captions: the gap a bare word needed to the page edge is the
    // sticker's own padding now. Found by the census in
    // sectionCaptionSticker.test.ts.
    margin: 0 0 $small;
    font-size: 1.15rem;
  }
}
</style>
