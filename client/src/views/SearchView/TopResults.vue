<template>
  <div class="search-page-top-results">
    <!-- No query yet. The page answers the question people arrive with when
      they do not know what to type: what have I got? Recent searches first
      (the shortest path back), then the artist band, then the numbers.
      Deliberately NOT here: "recently played" and "recently added" (home) or
      the charts (stats) — a row shown twice makes two screens the same one. -->
    <div v-if="!hasQuery" class="search-idle">
      <RecentSearches />
      <BrowseArtists />
      <LibraryNumbers />
      <!-- The floor. All three blocks above can come up empty at once — no
        recent searches, an empty or unreachable library, no stats — and this
        page used to carry the prompt unconditionally, so removing it opened a
        path to a completely blank screen. It stays out of the way whenever
        there is anything to browse, and out of the FAILED case too, where the
        band says something more useful. -->
      <NoItems
        v-if="!browse.artists.length && !browse.loading && !browse.failed"
        :icon="SearchSvg"
        :flag="true"
        :title="'Search your library'"
        :description="'Find songs, albums, artists, playlists and folders.'"
      />
    </div>

    <template v-else>
      <NoItems
        :title="'No results'"
        :description="'We can\'t find any results for your search.'"
        :icon="SearchSvg"
        :flag="noResults"
      />
      <RecentItems
        v-if="search.top_results.playlists.length"
        :title="'Playlists'"
        :items="
          search.top_results.playlists.map((i) => ({
            type: 'playlist',
            item: i,
          }))
        "
      />
      <div v-if="search.top_results.top_result && search.top_results.top_result.type" class="header">
        <div class="top">
          <h3 class="section-title">Top Result</h3>
          <TopItem />
        </div>
        <!-- Guarded on the results, like the sidebar twin does: the top result
          can be an album or an artist while no track title matched, and an
          empty list under a plate is a framed empty rectangle. Before the
          plate it was invisible, which is why only one of the two hosts
          carried the guard. -->
        <div v-if="search.top_results.tracks.length" class="tracks">
          <h3 class="section-title">Tracks</h3>
          <TopTracks />
        </div>
      </div>
      <RecentItems
        v-if="search.top_results.artists.length"
        :title="'Artists'"
        :items="
          search.top_results.artists.map((i) => ({
            type: 'artist',
            item: i,
          }))
        "
      />
      <RecentItems
        v-if="search.top_results.albums.length"
        :title="'Albums'"
        :items="
          search.top_results.albums.map((i) => ({
            type: 'album',
            item: i,
          }))
        "
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import useBrowseStore from "@/stores/searchBrowse";
import useSearchStore from "@/stores/search";

import SearchSvg from "@/assets/icons/search.svg";
import TopItem from "@/components/RightSideBar/Search/Top/TopItem.vue";
import TopTracks from "@/components/RightSideBar/Search/Top/TopTracks.vue";
import BrowseArtists from "@/components/SearchView/BrowseArtists.vue";
import LibraryNumbers from "@/components/SearchView/LibraryNumbers.vue";
import RecentItems from "@/components/shared/CardScroller.vue";
import NoItems from "@/components/shared/NoItems.vue";
import RecentSearches from "./RecentSearches.vue";

const search = useSearchStore();
const browse = useBrowseStore();

const hasQuery = computed(() => (search.query || "").trim().length > 0);
const noResults = computed(
  () =>
    (!search.top_results.top_result || !search.top_results.top_result.type) &&
    !search.top_results.playlists.length
);
</script>

<style lang="scss">
.search-page-top-results {
  height: 100%;
  overflow: auto;
  padding-left: $padleft;
  padding-right: $padright;
  // The player bar overlays the foot of every scroller and this one reserved
  // $padbottom (4rem) against a 5.125rem bar: measured at maximum scroll, the
  // last row sat 18px underneath it — the same shortfall styling.md records
  // for #307. The mixin is the one place the three breakpoints are written.
  //
  // NOT the `.content-page` class, which is where the mixin's other caller
  // lives: it also brings `scrollbar-gutter: stable both-edges` and an
  // alt-layout `padding-top`, and this page has its tab-chip row OUTSIDE the
  // scroller — measured, the gutter put the chips and the results on left
  // edges 12px apart, and the results started 2rem lower than before.
  @include player-bar-reserve;

  // The idle column: three blocks, one left edge, one rhythm between them.
  // The page indent is the host's above, so none of the three carries its own
  // — that is what keeps the recent plate, the letter band and the numbers on
  // the same line down the page.
  .search-idle {
    display: grid;
    gap: 2rem;

    // The prompt used to sit inside a block that claimed the full height, so
    // it centred itself in the page. In this auto-height column it would
    // collapse to its own content at the very top — a sentence stranded under
    // the top bar. It keeps a page's worth of room to centre in.
    .nothing {
      min-height: 24rem;
    }
  }

  .header {
    display: grid;
    grid-template-columns: max-content 1fr;
    gap: 1rem;

    @include largePhones {
      grid-template-columns: 1fr;
    }
  }

  // The two section captions of this page. They were the last ones in the app
  // still standing free on the doodle ground — every other one (the card-row
  // captions, "Top Tracks", "Browse Library", "Up Next"/"Queue", the chart
  // groups, the recent-searches head next door) had already opted into
  // `mem-sticker`; these two were simply never added to that list, and a
  // theme-aware `color` does nothing about a saturated shape running behind
  // the word.
  //
  // Scoped to the class, NOT to `h3`: the bare element selector in this file
  // also reaches the title *inside* the top-result card, which sits on a panel
  // and must not become a sticker on a plate.
  .section-title {
    @include mem-sticker;
    // On a sticker the inset is a MARGIN — as padding it would fatten the chip
    // instead of moving it (styling.md). The left value keeps the caption on
    // the same edge as the plate below it.
    margin: 0 0 $small;
    font-size: 1.15rem;
    font-weight: 700;
  }

  // The rows are `SongItem` now, and it brings its own translucent list plate:
  // `is_first`/`is_last` close the ink frame around it, the same anatomy the
  // Tracks tab and every song list use. So no plate here — a second one around
  // it would double the frame.
  //
  // (The plate this page used to draw was scoped here because TopTracks also
  // rendered inside the right sidebar, which had its own panel. That stopped
  // being true with #515: the sidebar IS the Now Playing panel, and the search
  // tabs that lived there are gone.)

  h3 {
    margin: $small;
    // The top-result card's own title. It sits on the card's panel, so it keeps
    // the theme-aware content colour rather than a plate.
    color: $mem-content-text;
  }

  .top-result-item {
    height: max-content;
    margin: 0;

    h3 {
      margin-left: 0;
    }

    @include largePhones {
      max-width: 100%;
    }

    @include mediumPhones {
      min-width: unset;
      max-width: 100%;
    }
  }

  .right-search-top-albums-or-artists {
    display: flex;
    width: calc(100% - 1.25rem);
    overflow-x: auto;

    @include hideScrollbars;
  }

  @include allPhones {
    padding-left: 1rem;
    padding-right: 1rem;
  }
}
</style>
