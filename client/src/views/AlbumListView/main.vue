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
          <component
            :is="item.component"
            :key="index"
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
import { useAlbumList, useArtistList } from "@/stores/pages/itemlist";

import Fetcher from "@/components/ArtistView/AlbumsFetcher.vue";
import CardRow from "@/components/shared/CardRow.vue";
import Header from "./Header.vue";
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

  items.push(
    ...[
      {
        id: "header",
        component: Header,
        props: {
          total: total.value,
        },
      },
      {
        id: "sortbanner",
        component: SortBanner,
      },
    ]
  );

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
    id: Math.random(),
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
