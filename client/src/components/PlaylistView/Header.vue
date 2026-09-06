<template>
  <!-- One plate, one image mode. The banner mode is gone: it put the playlist
       photo across the full width and needed a dark scrim so white text stayed
       legible on it — and it applied to 11 of 64 playlists, while the other 53
       showed the square collage anyway. The media cell takes photo and collage
       alike, so the second code path and its scrim are no longer needed. -->
  <div class="p-header">
    <div class="dh-art">
      <img v-if="info.has_image" :src="(playlist.info.image as string)" />
      <BannerImages v-else-if="playlist.info.count" />
    </div>
    <Info />
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from "pinia";

import usePStore from "@/stores/pages/playlist";

import BannerImages from "./Header/BannerImages.vue";
import Info from "./Header/Info.vue";

const playlist = usePStore();

const { info } = storeToRefs(playlist);
</script>

<style lang="scss">
// Geometry, frame, shadow and the small-screen sizes come from the shared
// anatomy in Global/detail-head.scss. Gone with the banner mode: the dark
// scrim, the white-text override, the background-position plumbing for
// `banner_pos`, and three breakpoint blocks that restated the cover size and
// the title size a second and third time.
.p-header {
  // The collage brings its own frame, radius and blush ground from the days
  // when it was a free-standing banner — inside the media cell that draws a
  // second ring, and its content height (a square) left a strip of bare panel
  // under it whenever the text side was taller. The cell owns frame and
  // clipping; the collage just fills it.
  .playlist-banner-images {
    height: 100%;
    border: none;
    border-radius: 0;
  }

  .playlist-collage {
    height: 100%;
  }
}
</style>
