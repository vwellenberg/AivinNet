<template>
  <!-- No .rounded utility here: it overrode the candy-box radius (16px vs the
       14px every other card uses) and made playlist tiles a different shape.

       And no .no-scroll either — `overflow: hidden` on the TILE clipped the
       offset shadows of the parts inside it. Since the tile became three
       separate plates (#382) it carries no surface of its own; the artwork
       keeps the clip it actually needs (below), the tile stays open. This was
       the only one of the five cards that clipped itself. -->
  <router-link :to="{ name: 'PlaylistView', params: { pid: playlist.id } }" class="p-card">
    <CardTypeLabel type="playlist" />
    <div v-if="!playlist.has_image && playlist.images.length" class="image card-art no-scroll">
      <PlaylistImages :images="playlist.images" size="large" />
      <PlayBtn :source="playSources.playlist" :playlist="playlist.id.toString()"/>
    </div>
    <div v-else class="image card-art">
      <img :src="imguri + playlist.thumb" />
      <PlayBtn :source="playSources.playlist" :playlist="playlist.id.toString()"/>
    </div>
    <div class="overlay card-plate">
      <div v-if="playlist.help_text && !isTypeEcho(playlist.help_text, 'playlist')" class="rhelp playlist">
        <span class="help">{{ playlist.help_text }}</span>
        <span class="time">{{ playlist.time }}</span>
      </div>
      <div class="p-name ellip">{{ playlist.name }}</div>
      <div class="p-count">
        <b>{{ playlist.count.toLocaleString() + ` Track${playlist.count === 1 ? "" : "s"}` }}</b>
      </div>
    </div>
  </router-link>
</template>

<script setup lang="ts">
import { paths } from "../../config";
import { Playlist } from "../../interfaces";
import { playSources } from '@/enums'
import CardTypeLabel from '../shared/CardTypeLabel.vue'
import PlayBtn from '../shared/PlayBtn.vue'
import PlaylistImages from '../shared/PlaylistImages.vue'
import { isTypeEcho } from '@/utils/cardTypes'

const imguri = paths.images.playlist;
defineProps<{
  playlist: Playlist;
}>();
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss): `.card-art` for the artwork, `.card-plate` for the text.
// Only what is specific to a playlist tile stays here.
.p-card {
  user-select: none;

  // `.overlay` IS the `.card-plate` (one element, two classes), so the column,
  // its rhythm and its vertical alignment all come from the shared anatomy
  // (Global/cards.scss). This block repeated them by hand and its
  // `justify-content: flex-start` was the last thing anchoring a playlist
  // tile's two lines to the top edge after the plate learned to centre them —
  // the same drift the anatomy exists to prevent. Only the type stays here.
  .overlay {
    .p-name {
      font-weight: 700;
      color: $candy-text;
    }

    .p-count {
      font-size: 0.75rem;
      color: $candy-text-muted;
    }
  }
}
</style>
