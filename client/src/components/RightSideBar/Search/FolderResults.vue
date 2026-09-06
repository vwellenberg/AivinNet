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

    button {
      padding: $small $medium;
      border: none;
      border-radius: $small;
      background-color: $gray;
      color: inherit;
      cursor: pointer;
      transition: background-color 0.2s ease-out;

      &:hover {
        background-color: $gray4;
      }
    }
  }
}
</style>
