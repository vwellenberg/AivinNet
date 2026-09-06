<template>
  <div class="search-view" :class="{ is_alt_layout, has_query }">
    <!-- The tab chips live HERE, in the page — never in the top bar. The old
      desktop layout rendered a second, four-entry copy of this switcher in the
      chrome (nav/Titles/SearchTitle.vue), which put content controls into the
      top bar and silently hid the playlists + folders tabs on wide screens.
      With no query there is nothing to filter (the page shows recent
      searches / an idle prompt), so the row only appears once a query exists. -->
    <div v-if="has_query" class="buttons-area">
      <Tabs
        :tabs="pages"
        :current-tab="($route.params.page as string)"
        @switchTab="(tab: string) => {
        $router.replace({ name: Routes.search, params: { page: tab }, query: {
          q: search.query,
        } });
        search.switchTab(tab);
      }"
      />
    </div>
    <div v-auto-animate class="page no-scroll">
      <component :is="component.component" v-bind="component.props" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { Routes } from "@/router";
import { computed, onMounted } from "vue";
import { useRoute } from "vue-router";

import { content_width } from "@/stores/content-width";
import useSearchStore from "@/stores/search";
import useSettings from "@/stores/settings";
import updatePageTitle from "@/utils/updatePageTitle";

import Tabs from "@/components/RightSideBar/Search/TabsWrapper.vue";
import CardGridPage from "./CardGridPage.vue";
import FolderResults from "@/components/RightSideBar/Search/FolderResults.vue";
import TopResults from "./TopResults.vue";
import TracksPage from "./tracks.vue";

const settings = useSettings();
const search = useSearchStore();

const is_alt_layout = computed(() => settings.is_alt_layout || content_width.value < 1100);
const has_query = computed(() => (search.query || "").trim().length > 0);

const pages = ["top", "tracks", "albums", "artists", "playlists", "folders"];

const route = useRoute();

const component = computed(() => {
  switch (route.params.page) {
    case pages[0]:
      return { component: TopResults };
    case pages[1]:
      return { component: TracksPage };
    case pages[2]:
      return {
        component: CardGridPage,
        props: {
          page: "album",
          items: search.albums.value,
          fetch_callback: search.loadAlbums,
        },
      };

    case pages[3]:
      return {
        component: CardGridPage,
        props: {
          page: "artist",
          items: search.artists.value,
          fetch_callback: search.loadArtists,
        },
      };

    case pages[4]:
      return {
        component: CardGridPage,
        props: {
          // Playlists are matched client-side; the full list is already loaded,
          // so there is no fetch_callback / pagination.
          page: "playlist",
          items: search.playlistCards,
        },
      };

    case pages[5]:
      return { component: FolderResults };

    default:
      return TracksPage;
  }
});

onMounted(() => {
  updatePageTitle("Search");
  search.switchTab(route.params.page as string);
  // `?q=` is optional — opening /search/top directly (deep link, reload, or a
  // tap on Search in the nav) has no query at all. The old `as string` cast
  // put `undefined` into the store, and the watcher there calls .trim() on it:
  // the resulting TypeError aborted the render, which is why the top bar came
  // up WITHOUT its search field and the page could not be used at all.
  search.query = (route.query.q as string) ?? "";
});
</script>

<style lang="scss">
.search-view {
  height: 100%;
  position: relative;
  display: grid;

  .buttons-area {
    position: relative;
    padding-left: $padleft;

    // No `border-radius` here: the scroller has no fill of its own, so the
    // pill radius was only ever a clip mask — invisible while the box was
    // exactly one chip tall, and a corner shave on the first and last chip
    // now that it reserves the shadow below them.
    //
    // The box itself is `mem-seg-scroll` (_candy.scss), shared with the
    // discography tabs and the charts header. It was the third hand-rolled
    // copy of that anatomy and had already drifted: the overhang the chips
    // actually need is 8px (the 4px offset plus their 1.04 hover scale), and
    // that is the ONE thing this caller states.
    //
    // Both `max-width: calc(100% - 16px)` are gone with it — here and on the
    // wrapper, which held the row 16px inside its own container a second time.
    // They were a shadow reserve written as a width cap, and a cap is the
    // wrong mechanism: the reserve has to sit INSIDE the scroll port, or it is
    // unreachable exactly when the row is scrolled to its end. Measured at
    // 1440px before this: the row ended at 1405 against a container edge of
    // 1437.
    .tabheaders {
      margin: 0;
      @include mem-seg-scroll($reserve: $small);
    }

    @include allPhones {
      padding-left: 1rem;
    }
  }

  // The chip row renders in every layout now (it used to be the alt-layout
  // half of a duplicated switcher; the other copy sat in the top bar), but
  // only while a query exists — so the grid row hangs on `has_query`, not on
  // the layout.
  &.has_query {
    // `max-content`, not a literal: the row used to be pinned to 2rem, which
    // was exactly the chip height of the day. A control that grows — to reach
    // the 44px touch target, say — then grows into a box that cannot follow,
    // and the row silently becomes a crop. The gap is $small because the
    // scroller already reserves $small below the chips for their shadow.
    grid-template-rows: max-content 1fr;
    gap: $small;
    padding-top: 1rem;

    // Only the alt layout gives every scroller 2rem of top padding
    // (app-grid.scss); with the chip row above, that padding doubles the gap.
    // Scoped to has_query: with no query there is no chip row, and the page
    // should breathe like every other alt-layout page.
    &.is_alt_layout .vue-recycle-scroller {
      padding-top: 0 !important;
    }
  }
}
</style>
