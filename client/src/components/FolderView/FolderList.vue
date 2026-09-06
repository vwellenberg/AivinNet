<template>
  <!--
    Folders are always a list. They used to be a grid of tiles with a setting to
    switch, but a folder tile carries nothing a row does not — no artwork, just a
    name — so the grid only made the same information take four times the space.
  -->
  <div class="f-container rounded-sm list-mode">
    <div id="f-items" class="rounded">
      <FolderItem v-for="folder in folders" :key="folder.path" :folder="folder" :folder_page="true" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Folder } from "@/interfaces";
import FolderItem from "./FolderItem.vue";

defineProps<{
  folders: Folder[];
}>();
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

  .f-item {
    line-height: 1.2;
    height: 3.25rem;
    background-color: transparent;
    padding-left: $small;
    // Flat row inside the plate — no tile, so no offset shadow either.
    box-shadow: none;
    // Reserved transparent border + the shared radius/transition, so the ink
    // frame below can appear without nudging the row's contents.
    @include candy-row-base;

    // List mode rows are transparent -> they sit on the page ground, so their
    // text/icon must be theme-aware (grid mode keeps ink on the pink card).
    color: $mem-content-text;

    svg {
      color: $mem-content-text;
    }

    .f-count {
      color: $mem-content-muted;
    }

    .options {
      display: block;
      background-color: transparent !important;
    }

    .info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-right: $medium;
    }

    // The app-wide row hover: light fill inside the ink frame, like every song
    // list row. These rows used `border: none` and a blush fill, so they were
    // the only hoverable rows in the app with no frame at all.
    // `!important` beats the grid-mode `.f-item:hover` fill above.
    &:hover {
      @include candy-row-hover;
      background-color: $mem-panel-static !important;
      color: $mem-ink;

      svg {
        color: $candy-black;
      }

      .f-count {
        color: $candy-text-muted;
      }
    }
  }
}
</style>
