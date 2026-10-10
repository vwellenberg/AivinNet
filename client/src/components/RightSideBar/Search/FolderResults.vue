<template>
  <div id="folder-results">
    <div v-if="!search.folders.value.length" class="t-center">
      <h5>No folders</h5>
    </div>

    <template v-else>
      <FolderList :folders="search.folders.value" />

      <div v-if="search.folders.more" class="folder-load-more">
        <button @click="search.loadFolders">Load More</button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import useSearch from "@/stores/search";

import FolderList from "@/components/FolderView/FolderList.vue";

const search = useSearch();
</script>

<style lang="scss">
#folder-results {
  padding-bottom: 1rem;

  .folder-load-more {
    display: flex;
    justify-content: center;
    margin-top: 1rem;

    // A word button, so the pill role (#424). It was a frameless tint: no frame,
    // no shadow and no hatch, next to "Load More" on every other list.
    button {
      @include btn-pill($fill: $candy-pink-soft);
      // The soft fill is theme-aware (dark in the dark theme), so the label is too:
      // the role's static ink would sit on a dark plate (measured, #424).
      color: $candy-text;

      &:hover {
        background-color: $gray4;
      }
    }
  }
}
</style>
