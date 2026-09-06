<template>
  <div class="now-playing-info">
    <div class="text">
      <div class="title">{{ queue.currenttrack?.title || "AivinNet" }}</div>
      <ArtistName
        v-if="queue.currenttrack"
        :artists="queue.currenttrack?.artists || null"
        :albumartists="queue.currenttrack?.albumartists || ''"
      />
      <span v-else class="artist author">
        <a href="https://github.com/mungai-njoroge" target="_blank">built by @mungai-njoroge ↗</a>
      </span>
    </div>
    <div class="actions">
      <HeartSvg
        btn_role="action"
        :state="queue.currenttrackIsFav"
        @handle-fav="$emit('handleFav', queue.currenttrackhash)"
      />
      <!-- A real <button>, not a bare glyph: this is a 44px touch target on a
           phone, and the dots are rotated on the GLYPH because the button's own
           `transform` belongs to the role (scale on hover, press on active). -->
      <button class="options" :class="{ context_menu_showing }" @click="showMenu">
        <OptionSvg />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from "vue";

import ArtistName from "../shared/ArtistName.vue";
import HeartSvg from "../shared/HeartSvg.vue";

import OptionSvg from "@/assets/icons/more.svg";
import { showTrackContextMenu } from "@/helpers/contextMenuHandler";
import useQueueStore from "@/stores/queue";

const context_menu_showing = ref(false);

const queue = useQueueStore();

defineEmits<{
  (e: "handleFav", trackhash: string): void;
}>();

function showMenu(e: MouseEvent) {
  if (!queue.currenttrack) return;

  showTrackContextMenu(e, queue.currenttrack, context_menu_showing);
}
</script>

<style lang="scss">
// The track's own plate, and the counterpart to the source plate above the
// cover. Title and artist used to sit straight on the memphis ground, where a
// muted grey line lands on whatever doodle happens to be behind it.
//
// It was a `1fr max-content` grid whose text item had no `min-width: 0`, so a
// long title wrapped to a second line and the whole block grew with it
// (measured on a 390px viewport: 42px -> 63px for "Brandenburgisches Konzert
// Nr. 4 G-Dur"). One line with an ellipsis keeps the height constant — and
// `min-width: 0` is what makes that possible here, because a flex item with
// `nowrap` would otherwise push the actions out instead of shrinking.
.now-playing-info {
  display: flex;
  align-items: center;
  gap: $small;
  margin-top: 1rem;
  padding: $smaller;
  padding-left: $medium;
  background-color: $mem-panel;
  border: $candy-border;
  border-radius: $candy-radius;
  box-shadow: 3px 3px 0 var(--mem-shadow);
  font-weight: 500;

  .text {
    flex: 1;
    // The half of the fix the old grid was missing.
    min-width: 0;
  }

  .title {
    font-weight: 700;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .artist {
    font-size: 0.8rem;
    color: $candy-text-muted;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: $small;
    flex-shrink: 0;

    // Same role, same 44px box as the overflow button in the header above —
    // this used to be a raw SVG scaled to 1.5, so it was neither a button nor
    // a touch target, and `transform: scale()` is not how this app sizes a
    // glyph.
    .options {
      @include btn-action($size: 2.75rem);

      svg {
        transform: rotate(90deg);
      }

      // Yellow is this design's "active"; the open menu keeps it rather than
      // borrowing the blush that means "hovered".
      &.context_menu_showing {
        background-color: $mem-yellow;
        border-color: $mem-line;
        color: $mem-ink;
      }
    }
  }

  .author {
    & > * {
      color: $candy-text-muted !important;
    }
  }
}
</style>
