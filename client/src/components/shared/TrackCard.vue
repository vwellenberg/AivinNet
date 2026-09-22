<template>
  <RouterLink
    v-context-menu="showMenu"
    :to="{
      name: Routes.album,
      params: {
        albumhash: track.albumhash,
      },
    }"
    class="trackcard"
    :class="{ 'context-menu-open': contextMenuFlag }"
  >
    <CardTypeLabel type="track" />
    <div class="image card-art">
      <img :src="paths.images.thumb.large + track.image" />
      <PlayBtn :source="playSource" :track="track" />
    </div>
    <div class="tinfo card-plate">
      <div v-if="track.help_text && !isTypeEcho(track.help_text, 'track')" class="rhelp track">
        <span class="help">{{ track.help_text }}</span>
        <span class="time">{{ track.time }}</span>
      </div>
      <div class="ttitle ellip">{{ track.title }}</div>
      <ArtistName :albumartists="track.albumartists" :artists="track.artists" />
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { paths } from "@/config";
import { playSources } from "@/enums";
import { Track } from "@/interfaces";

import { Routes } from "@/router";
import { ref } from "vue";
import { showTrackContextMenu } from "@/helpers/contextMenuHandler";
import ArtistName from "../shared/ArtistName.vue";
import CardTypeLabel from "../shared/CardTypeLabel.vue";
import PlayBtn from "../shared/PlayBtn.vue";
import { isTypeEcho } from "@/utils/cardTypes";

const props = defineProps<{
  track: Track;
  playSource: playSources;
}>();

const contextMenuFlag = ref(false);

function showMenu(e: MouseEvent) {
  showTrackContextMenu(e, props.track, contextMenuFlag);
}

defineEmits<{
  playThis: (index: number) => void;
}>();
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss). Only what is specific to a track tile stays here.
.trackcard {
  cursor: pointer;

  .ttitle {
    font-weight: 700;
    font-size: 0.95rem;
    color: $candy-text;
  }

  .artist {
    font-size: 0.8rem;
    font-weight: 500;
    color: $candy-text-muted;
  }
}
</style>
