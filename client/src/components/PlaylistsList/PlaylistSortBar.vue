<template>
  <div class="playlist-sort-bar">
    <!-- The same banner as the album and artist lists (SortBanner.vue, styles
         shared through sortbanner-styles.scss). The chips flip the direction
         on screen, not the URL's: this page's default is name ascending with
         no `reverse` in the URL. -->
    <div class="itemsortby">
      <div class="tt select circular">Sort By</div>
      <div class="left group">
        <SortKey :items="PLAYLIST_SORT_KEYS" :sortby="current.sortby" :reverse="current.reverse" flip-from="shown" />
      </div>
      <div class="right group">
        <div class="tt select circular"><ChartSvg /></div>
        <SortKey :items="PLAYLIST_STAT_SORT_KEYS" :sortby="current.sortby" :reverse="current.reverse" flip-from="shown" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import ChartSvg from '@/assets/icons/chart.svg'
import SortKey from '@/components/CardListView/SortKey.vue'
import {
  PLAYLIST_SORT_KEYS,
  PLAYLIST_STAT_SORT_KEYS,
  readPlaylistSortQuery,
} from '@/utils/playlistSort'

// The sort state lives in the URL, exactly like the album and artist banners.
// The search field is the page's (PlaylistList.vue): it sits in the head on
// the desktop, on the line of the "New playlist" actions.
const route = useRoute()
const current = computed(() => readPlaylistSortQuery(route.query))
</script>

<style lang="scss">
@import "@/components/CardListView/sortbanner-styles";

// The head above already ends in its own bottom padding on the desktop, and
// a phone starts the page here; the chip row needs no top padding of its own.
.playlist-sort-bar .itemsortby {
  padding-top: 0;
}
</style>
