<template>
  <div
    class="v-scroll-page artist-tracks-page"
    :class="{ isSmall, isMedium }"
    style="height: 100%"
  >
    <RecycleScroller
      id="artist-tracks-scroller"
      class="scroller"
      style="height: 100%"
      :items="scrollerItems"
      :item-size="itemHeight"
      key-field="id"
    >
      <!-- The page used to be the bare list: no name, no way back, no count.
           The head scrolls away with the rows, like every other detail page. -->
      <template #before>
        <ArtistTracksHead
          :artisthash="hash"
          :name="artistName"
          :image="artistImage ? paths.images.artist.small + artistImage : ''"
          :count="tracks.length"
          :duration="formatSeconds(duration, true)"
          :loaded="loaded"
          :sort="sort"
          :query="query"
          :matches="visible.length"
          @play="playAll"
          @update:sort="(s) => (sort = s)"
          @update:query="(q) => (query = q)"
        />
      </template>
      <template #default="{ item, index }">
        <SongItem
          :track="item.track"
          :index="index + 1"
          :is_first="index === 0"
          :is_last="index === scrollerItems.length - 1"
          :band_fade="trackBandFade(index + 1, scrollerItems.length)"
          :source="dropSources.artist"
          @playThis="playFromPage(index)"
        />
      </template>
    </RecycleScroller>
  </div>
</template>

<script setup lang="ts">
import { useRoute } from "vue-router";
import { computed, onMounted, Ref, ref, watch } from "vue";

import useQueue from "@/stores/queue";
import useTracklist from "@/stores/queue/tracklist";

import { paths } from "@/config";
import { Track } from "@/interfaces";
import { dropSources, FuseTrackOptions } from "@/enums";
import { getArtistSummary, getArtistTracks } from "@/requests/artists";
import { isMedium, isSmall } from "@/stores/content-width";
import { useListFind } from "@/helpers/useListFind";
import useFuse from "@/utils/useFuse";
import formatSeconds from "@/utils/useFormatSeconds";
import { ArtistTrackSort, sortArtistTracks, totalSeconds } from "@/utils/artistTracks";

import SongItem from "@/components/shared/SongItem.vue";
import { SONG_ROW_HEIGHT, trackBandFade } from "@/utils/songItemMethods";
import updatePageTitle from "@/utils/updatePageTitle";
import ArtistTracksHead from "@/components/ArtistView/ArtistTracksHead.vue";

const itemHeight = SONG_ROW_HEIGHT;
const route = useRoute();
const queue = useQueue();
const tracklist = useTracklist();

const hash = computed(() => route.params.hash as string);
const tracks: Ref<Track[]> = ref([]);
const artistName = ref((route.query.artist as string) || "");
const artistImage = ref("");
const loaded = ref(false);
const sort = ref<ArtistTrackSort>("plays");
const query = ref("");

async function load(artisthash: string) {
  loaded.value = false;
  query.value = "";
  // The name in the URL comes from the artist page; the summary is the
  // cheap route (no tracks, no albums) and fills in the picture and the
  // name for a deep link that arrives without `?artist=`.
  const [list, summary] = await Promise.all([getArtistTracks(artisthash), getArtistSummary(artisthash)]);
  if (artisthash !== hash.value) return;
  tracks.value = Array.isArray(list) ? list : [];
  if (summary) {
    artistName.value = summary.name || artistName.value;
    artistImage.value = summary.image || "";
  }
  loaded.value = true;
  updatePageTitle(artistName.value ? `${artistName.value} · Tracks` : "Artist Tracks");
}

onMounted(() => {
  updatePageTitle(artistName.value ? `${artistName.value} · Tracks` : "Artist Tracks");
  load(hash.value);
});

// Artist → Similar artist → its tracks keeps this component mounted.
watch(hash, (next, prev) => {
  if (next && next !== prev) {
    artistName.value = (route.query.artist as string) || "";
    artistImage.value = "";
    load(next);
  }
});

const sorted = computed(() => sortArtistTracks(tracks.value, sort.value));
const matches = useFuse(query, sorted, FuseTrackOptions);

/** The rows on screen: the chosen order, or the matches while a query is set. */
const visible = computed<Track[]>(() =>
  query.value ? matches.value.map((r) => r.item as Track) : sorted.value
);

useListFind("artist-tracks-find", "artist-tracks-scroller", () => tracks.value.length > 0, {
  query: () => query.value,
  rows: () => visible.value,
  at: "field",
});

const duration = computed(() => totalSeconds(tracks.value));

const scrollerItems = computed(() =>
  visible.value.map((track, index) => ({
    track,
    id: track.trackhash ? `${track.trackhash}-${index}` : index,
  }))
);

/**
 * Plays the rows as they stand — sorted and, while a find is set, filtered —
 * so "next" is the row under the one that was played, not the next one in
 * the server's playcount order.
 */
function playFromPage(index: number) {
  tracklist.setFromArtist(hash.value, artistName.value, visible.value);
  queue.play(index);
}

function playAll() {
  if (!visible.value.length) return;
  tracklist.setFromArtist(hash.value, artistName.value, visible.value);
  // Under shuffle this starts anywhere, like the artist page's Play.
  queue.playSource();
}
</script>
