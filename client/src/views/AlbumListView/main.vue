<template>
  <div class="albumlistview v-scroll-page">
    <DynamicScroller
      style="height: 100%"
      class="scroller"
      :min-item-size="64"
      :items="scrollerItems"
    >
      <!-- Zero-height probe with the exact width of every card row below:
           the group size must match the columns CSS actually builds. -->
      <template #before>
        <div ref="gridprobe" aria-hidden="true"></div>
      </template>
      <template #default="{ item, index, active }">
        <DynamicScrollerItem
          :item="item"
          :active="active"
          :size-dependencies="[item.props]"
          :data-index="index"
        >
          <!-- No `:key`: a key that changes with the item turns every
               recycle into a new row, replaying its entrance mid-scroll
               (census: components/__tests__/scrollerRecycling.test.ts). -->
          <component
            :is="item.component"
            v-bind="item.props"
          ></component>
        </DynamicScrollerItem>
      </template>
    </DynamicScroller>
  </div>
</template>

<script setup lang="ts">
import { Routes } from "@/router";
import { storeToRefs } from "pinia";
import { computed, ref } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from "vue-router";

import useCardGridColumns from "@/helpers/useCardGridColumns";
import { isMobile } from "@/stores/content-width";
import { useAlbumList, useArtistList } from "@/stores/pages/itemlist";

import Fetcher from "@/components/ArtistView/AlbumsFetcher.vue";
import CardRow from "@/components/shared/CardRow.vue";
import GenericHeader from "@/components/shared/GenericHeader.vue";
import SortBanner from "@/components/CardListView/SortBanner.vue";
import updatePageTitle from "@/utils/updatePageTitle";

const route = useRoute();
const store = route.name == Routes.AlbumList ? useAlbumList() : useArtistList();

// One component, two routes — the tab has to say which one it is.
updatePageTitle(route.name == Routes.AlbumList ? "Albums" : "Artists");

const { items: storeitems, total } = storeToRefs(store);

// Rows are partitioned by the columns the gapped grid really builds — the
// `maxAbumCards` heuristic ignores the gap and would overshoot by one near
// the breakpoints, wrapping the surplus card inside every row.
const gridprobe = ref<HTMLElement | null>(null);
const columns = useCardGridColumns(gridprobe);

const scrollerItems = computed(() => {
  const items = [];

  // Empty head: the left navigation names this page; it stays for the
  // spacing above the first row on the phone ($phone-page-start). NOT on any
  // wider layout, where the container gives the page its start ($page-start)
  // and the head would add nothing — and an item of 0px is one the
  // DynamicScroller never counts as measured: it kept the 64px estimate, and
  // the chips stood 64px below every other page's first line. `isMobile` is
  // the same 900px window line as `allPhones`/`desktopPage` in the styles.
  if (isMobile.value) {
    items.push({
      id: "header",
      component: GenericHeader,
    });
  }

  items.push({
    id: "sortbanner",
    component: SortBanner,
  });

  const groups = Math.ceil(storeitems.value.length / columns.value);
  for (let i = 0; i < groups; i++) {
    items.push({
      id: i,
      component: CardRow,
      props: {
        type: route.name == Routes.AlbumList ? "album" : "artist",
        items: storeitems.value.slice(
          i * columns.value,
          (i + 1) * columns.value
        ),
      },
    });
  }

  items.push({
    // Stable (#142) — see AlbumsFetcher: visibility triggers the next page.
    id: "list-fetcher",
    component: Fetcher,
    props: {
      fetch_callback: () => store.getMoreAlbums(),
      show_text: storeitems.value.length < total.value && store.canFetch,
    },
  });

  return items;
});

onBeforeRouteUpdate((to, from, next) => {
  const { sortby, reverse } = to.query;

  // The navigation links to the bare route. Read as a sort, that query reset
  // the list to `sortby=undefined` — the server's oldest-first fallback with no
  // chip highlighted. No sort in the link means: keep the current one.
  if (sortby === undefined && reverse === undefined) return next();

  store.setSort(sortby as string);
  store.setReverse(reverse == "1");

  next();
  store.restart();
});

onBeforeRouteLeave(() => {
  store.clearStore(route.name as string);
});
</script>

<style lang="scss">
.albumlistview {
  height: 100%;
}
</style>
@/stores/pages/itemlist
