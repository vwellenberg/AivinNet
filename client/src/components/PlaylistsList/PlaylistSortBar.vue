<template>
  <div class="playlist-sort-bar">
    <div class="playlist-search">
      <ListFind v-model="search" field-id="playlists-search" placeholder="Search playlists" />
    </div>

    <!-- The same banner as the album and artist lists (SortBanner.vue): the
         `.itemsortby` look comes from the shared mixin. The chips are a local
         copy of SortKey, because SortKey toggles from the URL's `reverse` and
         so starts a fresh name sort at descending — the playlist page's
         default is name ascending, and SortKey stays as it is for the other
         pages. -->
    <div class="itemsortby">
      <div class="tt select circular">Sort By</div>
      <div class="left group">
        <RouterLink
          v-for="item in PLAYLIST_SORT_KEYS"
          :key="item.key"
          :to="chipTo(item.key)"
          class="select rounded-sm"
          :class="{ reverse: current.reverse, active: item.key === current.sortby }"
        >
          {{ item.displayName }}
          <svg
            v-if="item.key === current.sortby"
            width="18"
            height="18"
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="direction"
          >
            <path
              d="M5.69434 13.6455C5.69434 13.9092 5.80859 14.1641 6.01074 14.3574L11.8027 20.1494C12.0137 20.3516 12.251 20.4482 12.4883 20.4482C13.042 20.4482 13.4375 20.0527 13.4375 19.5254C13.4375 19.2529 13.332 19.0156 13.1562 18.8486L11.1875 16.8535L8.58594 14.4805L10.6426 14.6035H21.3301C21.9014 14.6035 22.3057 14.208 22.3057 13.6455C22.3057 13.0742 21.9014 12.6875 21.3301 12.6875H10.6426L8.59473 12.8105L11.1875 10.4375L13.1562 8.44238C13.332 8.2666 13.4375 8.0293 13.4375 7.75684C13.4375 7.22949 13.042 6.84277 12.4883 6.84277C12.251 6.84277 12.0137 6.93066 11.7852 7.15039L6.01074 12.9336C5.80859 13.1182 5.69434 13.3818 5.69434 13.6455Z"
              fill="currentColor"
            />
          </svg>
        </RouterLink>
      </div>
      <div class="right group">
        <div class="tt select circular"><ChartSvg /></div>
        <RouterLink
          v-for="item in PLAYLIST_STAT_SORT_KEYS"
          :key="item.key"
          :to="chipTo(item.key)"
          class="select rounded-sm"
          :class="{ reverse: current.reverse, active: item.key === current.sortby }"
        >
          {{ item.displayName }}
          <svg
            v-if="item.key === current.sortby"
            width="18"
            height="18"
            viewBox="0 0 28 28"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            class="direction"
          >
            <path
              d="M5.69434 13.6455C5.69434 13.9092 5.80859 14.1641 6.01074 14.3574L11.8027 20.1494C12.0137 20.3516 12.251 20.4482 12.4883 20.4482C13.042 20.4482 13.4375 20.0527 13.4375 19.5254C13.4375 19.2529 13.332 19.0156 13.1562 18.8486L11.1875 16.8535L8.58594 14.4805L10.6426 14.6035H21.3301C21.9014 14.6035 22.3057 14.208 22.3057 13.6455C22.3057 13.0742 21.9014 12.6875 21.3301 12.6875H10.6426L8.59473 12.8105L11.1875 10.4375L13.1562 8.44238C13.332 8.2666 13.4375 8.0293 13.4375 7.75684C13.4375 7.22949 13.042 6.84277 12.4883 6.84277C12.251 6.84277 12.0137 6.93066 11.7852 7.15039L6.01074 12.9336C5.80859 13.1182 5.69434 13.3818 5.69434 13.6455Z"
              fill="currentColor"
            />
          </svg>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'

import ListFind from '@/components/shared/ListFind.vue'
import ChartSvg from '@/assets/icons/chart.svg'
import {
  PLAYLIST_SORT_KEYS,
  PLAYLIST_STAT_SORT_KEYS,
  readPlaylistSortQuery,
} from '@/utils/playlistSort'

// The search term lives with the page (it filters three groups); the sort
// state lives in the URL, exactly like the album and artist banners.
const search = defineModel<string>({ default: '' })

const route = useRoute()
const current = computed(() => readPlaylistSortQuery(route.query))

/** Clicking the active chip flips the direction; a new chip starts descending. */
function chipTo(key: string) {
  const active = key === current.value.sortby
  const reverse = active ? !current.value.reverse : true
  return {
    name: route.name as string,
    query: { sortby: key, reverse: reverse ? '1' : '0' },
    replace: true,
  }
}
</script>

<style lang="scss">
@import "@/components/CardListView/sortbanner-styles";

.playlist-sort-bar {

  .playlist-search {
    padding: 1rem $medium 0 0;

    @include allPhones {
      padding-top: 0;
    }

    .list-find {
      flex: 0 1 24rem;

      @include allPhones {
        flex: 1 1 auto;
        width: 100%;
      }
    }
  }
}
</style>
