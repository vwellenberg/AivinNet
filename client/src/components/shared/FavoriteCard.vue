<template>
  <!-- "You played from your favourites" — the sixth item type the Home rows
       receive. The server has sent it all along (lib/home/recover_items.py:
       `{ count, image }`); until #227 there was no card for it, and
       `<component :is="undefined">` rendered nothing: the tile vanished and the
       row came up one short of its neighbours. -->
  <RouterLink :to="{ name: Routes.favorites }" class="favcard">
    <CardTypeLabel type="favorite" />
    <div class="card-art" :class="{ 'is-glyph': !favorite.image }">
      <img v-if="favorite.image" :src="imguri + favorite.image" alt="" />
      <BookmarkSvg v-else class="bg" />
      <PlayBtn :source="playSources.favorite" />
    </div>

    <div class="card-plate">
      <div class="title ellip">Favorites</div>
      <div class="count">
        <b>{{ favorite.count.toLocaleString() }} Track{{ favorite.count === 1 ? "" : "s" }}</b>
      </div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { paths } from "@/config";
import { playSources } from "@/enums";
import { Routes } from "@/router";

import BookmarkSvg from "@/assets/icons/bookmark.svg";
import CardTypeLabel from "./CardTypeLabel.vue";
import PlayBtn from "./PlayBtn.vue";

const imguri = paths.images.thumb.medium;

defineProps<{
  favorite: {
    count: number;
    /** The last favourited track's artwork, or null when there is none. */
    image: string | null;
  };
}>();
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss). Only what is specific to this tile stays here.
.favcard {
  .title {
    font-weight: 700;
    color: $candy-text;
  }

  .count {
    font-size: 0.75rem;
    color: $candy-text-muted;
  }

  // The favourites section is a bookmark, never a heart — same glyph as its
  // type label and the sidebar entry.
  svg.bg {
    width: 3.6rem;
    height: 3.6rem;
    color: $candy-text-muted;
  }
}
</style>
