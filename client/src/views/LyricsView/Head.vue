<template>
  <div v-if="queue.currenttrack" class="lyricsinfo">
    <RouterLink
      :to="{
        name: Routes.album,
        params: {
          albumhash: queue.currenttrack.albumhash,
        },
      }"
    >
      <img :src="paths.images.thumb.small + queue.currenttrack.image" />
    </RouterLink>

    <div class="text">
      <div class="title ellip">{{ queue.currenttrack.title }}</div>
      <ArtistName :artists="queue.currenttrack.artists" :albumartists="queue.currenttrack.albumartists" />
    </div>
    <div class="right">
      <div v-if="lyrics.lyrics.length" class="lyricstype" :class="{ synced: lyrics.synced }">
        {{ lyrics.synced ? "synced" : "unsynced" }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import useLyrics from "@/stores/lyrics";
import useQueue from "@/stores/queue";

import ArtistName from "@/components/shared/ArtistName.vue";
import { paths } from "@/config";
import { Routes } from "@/router";

const queue = useQueue();
const lyrics = useLyrics();
</script>

<style lang="scss">
.lyricsinfo {
  display: grid;
  grid-template-columns: max-content 1fr max-content;
  gap: $medium;
  align-items: center;
  max-width: 54rem;
  margin-bottom: $small;
  padding: 0.7rem 0.9rem;
  position: sticky;
  top: 0;
  z-index: 1;
  // The head is CHROME, so it takes the opaque panel surface while the lyrics
  // below take the translucent veil: the lines scroll BEHIND this plate, and a
  // translucent head would show them passing through its own text.
  background-color: $mem-panel;
  color: $mem-content-text;
  border: $candy-border;
  border-radius: $candy-radius;
  @include candy-shadow(3px, 3px);

  @include allPhones {
    gap: $small;
  }

  // The COVER link only — a bare `a` selector also catches the artist links
  // inside ArtistName, and `line-height: 0` collapses their line box to zero
  // height: the artist name is still in the DOM, still ink, and invisible.
  > a {
    display: block;
    line-height: 0;
  }

  img {
    display: block;
    width: 3rem;
    height: 3rem;
    object-fit: cover; // fixed box: non-square artwork would be stretched
    border: $candy-border;
    border-radius: $candy-radius-sm;
    // Stuck on, like the artwork in a song row: offset shadow and a slight tilt.
    box-shadow: 3px 3px 0 var(--mem-shadow);
    transform: rotate(-2.5deg);
  }

  .text {
    min-width: 0;
  }

  .title {
    font-size: 1.05rem;
    font-weight: 700;
    line-height: 1.2;
  }

  .artist {
    font-size: 0.85rem;
    color: $mem-content-muted;
  }

  .lyricstype {
    padding: 0.25rem 0.6rem;
    border: $candy-border-w solid $candy-black;
    border-radius: $candy-radius-pill;
    // Static accents in both themes, so the label on them stays static ink.
    background-color: $candy-lavender;
    color: $candy-black;
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;

    &.synced {
      background-color: $mem-teal;
    }
  }
}
</style>
