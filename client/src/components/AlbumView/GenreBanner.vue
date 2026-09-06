<template>
  <div class="genres-banner">
    <div class="scrollable">
      <div class="genre-chip is-label">
        {{ genres.length ? "Genres" : "No genres" }}
      </div>
      <div v-for="genre in genres" :key="genre.genrehash" class="genre-chip">
        {{ genre.name }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import useAlbumStore from "@/stores/pages/album";
import useArtistStore from "@/stores/pages/artist";
import { computed } from "vue";

const album = useAlbumStore();
const store = useArtistStore();

const props = defineProps<{
  source: string;
}>();

const genres = computed(() => {
  return props.source === "album" ? album.info.genres : store.info.genres;
});

// const hookAction = async () => {
//   if (props.source === "album") {
//     // fetch data to be used in the component below this one.
//     await album.fetchArtistAlbums();
//     return;
//   }
// };

// onMounted(hookAction);
</script>

<style lang="scss">
.genres-banner {
  margin-top: 2rem;
  padding-bottom: 2rem;
  font-size: 0.9rem;
  // No left inset. The chips carry their own padding, so a container inset
  // moves the whole row off the page's leading edge — measured 315px against
  // 303px for the caption, the cards and the stat tiles on the same screen.
  // It is the same leftover the sort banner's chip row had (#528), one page
  // further along, and the stat row below it kept the other half.
  text-transform: capitalize;
  user-select: none;
  overflow: scroll;
  @include hideScrollbars;

  .scrollable {
    display: flex;
    flex-wrap: nowrap;
    width: max-content;
    gap: 1rem;
    padding-right: $medium;
    // ⚠️ No `overflow-x` here. The horizontal scroll belongs to `.genres-banner`
    // (this element is `width: max-content` and never overflows), and setting
    // ONE axis to anything but `visible` computes the OTHER to `auto` — which
    // makes this a clip box exactly one chip tall and cuts the bottom 3px off
    // every chip's offset shadow. Measured before the fix: 9 device pixels of
    // ink under a chip, all of it the border, then bare ground. Same trap as
    // the search tabs (RightSideBar/Search/TabsWrapper.vue).
    -webkit-overflow-scrolling: touch;
  }

  // A genre is a LABEL, not a control: nothing here is clickable, so these are
  // stickers (plate, ink frame, hard offset shadow, no hatch) and not the
  // action role the sort chips next door take. They used to hand-roll a plate
  // with a 1px border and no shadow at all — the only hairline in a row of 3px
  // frames, sitting flat between the raised cards above and the raised stat
  // tiles below.
  //
  // ⚠️ The fill is a STATIC accent, so the text on it is static ink in both
  // themes — `mem-sticker` sets the theme-aware pair for a panel surface, and
  // both halves have to move together (see the token note in _candy.scss).
  .genre-chip {
    @include mem-sticker($candy-radius-pill, 0.3rem 0.85rem);
    background-color: $mem-lavender;
    color: $mem-ink;
    font-weight: 700;
    white-space: nowrap;
  }

  // The row's own caption. Blush is this design's label colour — the sidebar's
  // LIBRARY heading wears it for the same reason — so the label reads as the
  // thing that names the row rather than as another genre.
  .genre-chip.is-label {
    background-color: $mem-blush;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    font-size: 0.8rem;
  }
}
</style>
