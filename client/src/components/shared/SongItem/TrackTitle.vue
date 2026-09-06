<template>
  <div class="tracktitle flex">
    <div class="thumbnail" @click.prevent="$emit('play')">
      <!-- ⚠️ `draggable="false"` is load-bearing, not tidiness. An <img> is
           natively draggable, so grabbing the cover fires `dragstart` on the
           ROW — including on rows that never opted into dragging. The index
           that travels with it belongs to whatever list this row is in, and a
           drop target reading it as its own position moves the wrong track. -->
      <img :src="imguri + track.image" class="album-art image rounded-sm" draggable="false" />
      <div class="thumb-play-overlay" v-if="!is_current">
        <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      </div>
    </div>
    <div v-tooltip class="song-title">
      <div class="with-flag" @click.prevent="$emit('play')">
        <span class="title ellip" :class="{ 'is-current': is_current }">
          {{ track.title }}
        </span>
        <ExplicitIcon  class="explicit-icon" v-if="track.explicit" />
        <MasterFlag :bitrate="track.bitrate" />
      </div>
      <div class="isSmallArtists">
        <ArtistName :artists="track.artists" :albumartists="track.albumartists" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Track } from "@/interfaces";
const imguri = paths.images.thumb.small;

import ArtistName from "../ArtistName.vue";
import MasterFlag from "../MasterFlag.vue";
import ExplicitIcon from "@/assets/icons/explicit.svg";

import { paths } from "@/config";

defineProps<{
  track: Track;
  is_current: boolean;
}>();

defineEmits<{
  (e: "play"): void;
}>();
</script>

<style lang="scss">
.songlist-item > .tracktitle {
  position: relative;
  align-items: center;

  .explicit-icon {
    margin-left: $small;
  }

  .thumbnail {
    margin-right: $medium;
    display: flex;
    position: relative;
    flex-shrink: 0;

    // Glued into the inlay: the full ink frame and the offset shadow every
    // other image surface in this app wears, plus a slight tilt. The 1px hairline
    // it replaces was the one picture frame in the design that wasn't one.
    //
    // The shadow survives here because the row only clips on the state that
    // fills it (`overflow: hidden` comes with mem-now-playing-row), and even
    // there the cover sits an inset and an index column clear of the edge —
    // the case .claude/rules/styling.md warns about is a box sized exactly to
    // its content, which this is not.
    .album-art {
      width: 3rem;
      height: 3rem;
      object-fit: contain;
      cursor: pointer;
      z-index: 20;
      border: $candy-border;
      border-radius: $candy-radius-sm;
      @include candy-shadow(2px, 3px);
      transform: rotate(-2.5deg);
      // `box-shadow` and `transform` have to be listed once the mixin's own
      // transition is overridden by this one — a later `transition` wins whole,
      // not per-property.
      transition: filter 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
    }

    // Straightens under the pointer: the tilt says "stuck on", the snap-to-square
    // says "and you can pick it up".
    //
    // Pointer devices only. `:hover` latches on touch (styling.md), so ungated
    // this said "you can pick it up" permanently on whichever row was tapped
    // last — the tilt is the row's resting state, and a phone had one row
    // stuck out of it with no way back (#457).
    @media (hover: hover) {
      &:hover .album-art {
        transform: rotate(0deg);
      }
    }

    .thumb-play-overlay {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      z-index: 30;
      pointer-events: none;
      transition: opacity 0.15s ease;

      svg {
        width: 1.4rem;
        height: 1.4rem;
        color: white;
        filter: drop-shadow(0 1px 3px rgba(0,0,0,0.6));
      }
    }

    @include smallerPhones {
      margin-right: $small;
    }
  }

  .song-title > .isSmallArtists {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: small;
    opacity: 0.67;
  }

  .song-title {
    display: flex;
    flex-direction: column;
    gap: 2px;
    cursor: pointer;

    .with-flag {
      display: flex;
      align-items: center;
    }

    .title {
      font-weight: 600;
    }

    // Highlight the title of the currently-playing track (issue #67). This
    // title always sits on the .current (yellow) row, so pin static ink.
    .title.is-current {
      color: $mem-ink;
    }
  }
}
</style>
