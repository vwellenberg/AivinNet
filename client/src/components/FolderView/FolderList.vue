<template>
  <!--
    Folders are always a list. They used to be a grid of tiles with a setting to
    switch, but a folder tile carries nothing a row does not — no artwork, just a
    name — so the grid only made the same information take four times the space.
  -->
  <div class="f-container rounded-sm list-mode">
    <div id="f-items" class="rounded">
      <FolderItem
        v-for="(folder, i) in folders"
        :key="folder.path"
        :folder="folder"
        :folder_page="true"
        :band_class="trackBandClass(i)"
        :band_fade="trackBandFade(i + 1, folders.length)"
        :max_count="maxCount"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { Folder } from "@/interfaces";
import { trackBandClass, trackBandFade } from "@/utils/songItemMethods";
import FolderItem from "./FolderItem.vue";

const props = defineProps<{
  folders: Folder[];
}>();

// The gauge is relative to THIS list, so the biggest folder on screen is full.
// A lone folder has nothing to be compared with — a full bar there says
// nothing, so it gets none (undefined = no gauge, see FolderItem).
const maxCount = computed(() =>
  props.folders.length > 1 ? Math.max(0, ...props.folders.map(folder => folder.trackcount || 0)) : undefined
);
</script>

<style lang="scss">
.f-container {
  padding-bottom: 1.25rem;
}

#f-items {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10rem, 1fr));
  gap: 1.5rem;
}

// Grid mode cards already carry a permanent ink frame (see FolderItem.vue), so
// hover only deepens the fill — the frame is already there.
.f-item:hover {
  background-color: $candy-pink-deep;
}

.f-container.list-mode > #f-items {
  grid-template-columns: 1fr;
  gap: 0;
  // Translucent plate under the folder rows — the same --mem-veil the track
  // lists use. List-mode rows are transparent, so the folder names sat
  // straight on the doodled grid ground and were the worst-reading text in
  // the app; the plate lifts them while the pattern still shimmers through.
  // Panel-level, not per row: the rows keep their own hover frame, and the
  // small padding keeps that frame from doubling up with this one.
  background-color: var(--mem-veil);
  border: $candy-border;
  border-radius: $candy-radius-sm;
  padding: $smaller;

  // ---------------------------------------------------------------------------
  // THE FOLDER ROW IS AN INLAY LINE — the song list's anatomy, one level up.
  //
  // Guide band on the leading edge (same two accents and the same position
  // fade as the track rows: mem-band-cycle + trackBandClass/trackBandFade),
  // perforation between rows, the count in the duration pill's ring. The glyph
  // sits on a tile in the FOLDER entity colour, so a folder looks like a folder
  // everywhere the entity palette is used.
  //
  // The size gauge is the one thing a track row has no twin for: on a library
  // whose folders run from 3 to 7,662 files, "which of these is the big one"
  // is the question a folder list actually gets asked (log scale, folderRow.ts).
  //
  // No hatch: a full-width content list where every row is a link has nothing
  // for the texture to mark (#468, styling.md).
  // ---------------------------------------------------------------------------
  .f-item {
    line-height: 1.2;
    // Google's one-line list row, which this also is on a phone ($phone-list-row).
    height: $phone-list-row;
    background-color: transparent;
    // The count column is FIXED: as `max-content` it followed each row's pill
    // ("3 Files" vs "7,667 Files"), and the gauges beside it stood ragged
    // instead of in one column. 5.5rem holds "12,671 Files".
    grid-template-columns: max-content minmax(0, 1fr) 7.5rem 5.5rem;
    gap: $medium;
    padding: 0 $medium 0 calc(#{$songlist-band-w} + #{$small});
    // Flat row inside the plate — no tile, so no offset shadow either.
    box-shadow: none;
    // The pointer flip is a CUT (styling.md): the base card's background fade
    // would cross the dark hover fill against the flipped text and leave a
    // grey mid-frame in which the name is unreadable.
    transition: none;
    // Reserved transparent border + the shared radius/transition, so the ink
    // frame below can appear without nudging the row's contents.
    @include candy-row-base;
    // At rest the rows stack into one continuous spine; the plate's own frame
    // rounds the whole list. The hover frame brings its own radius back.
    border-radius: 0;
    @include mem-band-cycle;

    // Band + perforation, painted as background layers like the track rows
    // (app-grid.scss): the first layer paints on top.
    background-image: repeating-linear-gradient(
        90deg,
        var(--look-perforation, #{$mem-line}) 0 3px,
        transparent 3px 7px
      ),
      linear-gradient(var(--band), var(--band));
    background-repeat: no-repeat;
    background-origin: border-box;
    background-position: calc(#{$songlist-band-w} + #{$small}) bottom, left top;
    background-size: calc(100% - #{$songlist-band-w} - #{$small}) 2px, $songlist-band-w 100%;

    // List mode rows are transparent -> they sit on the page ground, so their
    // text/icon must be theme-aware (grid mode keeps ink on the pink card).
    color: $mem-content-text;

    .f-glyph {
      display: grid;
      place-items: center;
      width: $control-compact;
      height: $control-compact;
      @include mem-entity-tint("folder");
      border: $mem-ring-w solid $mem-line;
      border-radius: $candy-radius-sm;

      svg {
        color: $mem-ink;
        height: 1.25rem;
        width: 1.25rem;
      }
    }

    .f-name {
      display: flex;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
    }

    .f-ordinal {
      font-size: $medium;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.05em;
      color: $mem-content-muted;
    }

    .f-item-text {
      margin-right: 0;
    }

    .f-gauge {
      height: 0.625rem;
      border: $mem-ring-w solid var(--look-badge-line, currentColor);
      border-radius: $candy-radius-xs;
      overflow: hidden;
    }

    .f-gauge-fill {
      display: block;
      height: 100%;
      background-color: mem-pastel(map-get($mem-entities, "folder"));
      // The pastel alone is too pale against the veil; an ink edge makes the
      // fill's END the readable mark, the same move as the favourites disc.
      box-shadow: inset (-$mem-ring-w) 0 0 $mem-ink;
    }

    // The duration pill's ring, so a count reads as a count in both lists.
    .f-count {
      justify-self: end;
      font-size: $medium;
      font-weight: 600;
      font-variant-numeric: tabular-nums;
      color: $mem-content-muted;
      border: $mem-ring-w solid var(--look-badge-line, currentColor);
      border-radius: $candy-radius-pill;
      padding: 0.12rem 0.5rem;
    }

    @include allPhones {
      grid-template-columns: max-content minmax(0, 1fr) max-content;

      .f-gauge {
        display: none;
      }
    }

    .options {
      display: block;
      background-color: transparent !important;
    }

    // The context menu owns this row: blush, like a track row's `.contexton`.
    &.context_menu_showing {
      @include candy-row-hover($fill: $mem-blush);
      background-image: none;
      color: $mem-ink;

      .f-ordinal,
      .f-count {
        color: inherit;
      }
    }

    // The app-wide row hover: contrast fill inside the ink frame, like every
    // song list row. Pointer-gated like the track rows (#457): a latched tap on
    // a touch screen must not strip the band and perforation.
    @media (hover: hover) {
      &:hover:not(.context_menu_showing) {
        @include candy-row-hover;
        background-image: none;

        .f-ordinal,
        .f-count {
          color: inherit;
        }
      }
    }
  }

  // The plate rounds the list; the first and last row follow its inner corner.
  > a:first-child .f-item {
    border-top-left-radius: $candy-radius-xs;
    border-top-right-radius: $candy-radius-xs;
  }

  // The last row closes against the plate's frame — no perforation under it.
  > a:last-child .f-item:not(.context_menu_showing) {
    border-bottom-left-radius: $candy-radius-xs;
    border-bottom-right-radius: $candy-radius-xs;
    background-image: linear-gradient(var(--band), var(--band));
    background-position: left top;
    background-size: $songlist-band-w 100%;

    // This selector outranks the row's hover rule, so it has to step aside for
    // the pointer itself — or the band would peek out inside the hover frame.
    @media (hover: hover) {
      &:hover {
        @include candy-row-hover;
        background-image: none;
      }
    }
  }
}
</style>
