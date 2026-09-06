<template>
  <div class="content-page artistdiscogview">
    <GenericHeader>
      <template #name>{{ getTypeName(route.params.type) }}</template>
      <!-- Whose discography this is, and the way back to them. It sat in
           `#description`, which GenericHeader never paints (#538) — so this
           page announced "Albums" without naming the artist and had no visible
           route back. `#after` is the head's own content slot and IS painted. -->
      <template #after>
        <RouterLink
          class="discog-context"
          :to="{
            name: Routes.artist,
            params: {
              hash: route.params.hash,
            },
          }"
        >
          <ArrowSvg class="back-arrow" />
          <span class="who">{{ route.query.artist }}</span>
          <span class="count">
            {{ artist.toShow.length }}
            <span class="caps">{{ getTypeString(route.params.type.toString()) }}</span>
          </span>
        </RouterLink>
      </template>
    </GenericHeader>
    <GenericTabs
      :items="
        Object.values(discographyAlbumTypes).map((type) => ({
          title: type,
          params: {
            hash: route.params.hash,
            type: type,
          },
          query: { artist: route.query.artist },
        }))
      "
      :active="
        (item) => {
          return item.title == route.params.type;
        }
      "
      :route="Routes.artistDiscography"
    /><br />
    <div v-if="artist.toShow.length" class="cards">
      <AlbumCard
        v-for="album in artist.toShow.sort((a, b) => parseInt(String(b.date)) - parseInt(String(a.date)))"
        :key="album.albumhash"
        :album="album"
        :artist_page="true"
        :show_date="true"
      />
    </div>
    <NoItems
      v-else
      :title="'No contributions'"
      :flag="!artist.toShow.length"
      :icon="AlbumSvg"
      :description="`No ${getTypeName($route.params.type)} found for ${route.query.artist}`"
    />
  </div>
</template>

<script setup lang="ts">
import { Routes } from "@/router";
import { onMounted } from "vue";
import { onBeforeRouteLeave, onBeforeRouteUpdate, useRoute } from "vue-router";

import { discographyAlbumTypes } from "@/enums";
import useArtistDiscography from "@/stores/pages/artistDiscog";
import updatePageTitle from "@/utils/updatePageTitle";

import AlbumSvg from "@/assets/icons/album.svg";
import ArrowSvg from "@/assets/icons/arrow.svg";
import AlbumCard from "@/components/shared/AlbumCard.vue";
import GenericHeader from "@/components/shared/GenericHeader.vue";
import GenericTabs from "@/components/shared/GenericTabs.vue";
import NoItems from "@/components/shared/NoItems.vue";

const route = useRoute();
const artist = useArtistDiscography();

function getTypeString(type: string) {
  if (type === "all") return "Contributions";
  return getTypeName(type);
}

function getTypeName(type: string | string[]) {
  // @ts-ignore
  if (type == "all") return "All Albums";
  return type;
}

onMounted(() => {
  updatePageTitle("Discography" + (route.params.artist || ""));
  artist.fetchAlbums(route.params.hash as string);
});

onBeforeRouteUpdate((to, from, next) => {
  artist.setAlbums(to.params.type as string);
  next();
});

onBeforeRouteLeave(() => artist.resetStore());
</script>

<style lang="scss">
.artistdiscogview {
  height: 100%;
  overflow: auto;

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax($cardwidth, 1fr));
    gap: $card-row-gap $card-col-gap;

    @include mediumPhones {
      grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
    }
  }

  .generichead {
    h1,
    .caps {
      text-transform: capitalize;
    }
  }

  // Whose discography this is — a sticker, like every other caption on the
  // ground, so it starts on the page's leading edge (styling.md) and reads
  // over whatever doodle happens to sit behind it.
  .discog-context {
    @include mem-sticker;
    display: inline-flex;
    align-items: center;
    gap: $small;
    font-weight: 600;
    // 44px, the touch-target floor (styling.md). It is a caption in shape but a
    // CONTROL in function — and on a phone the only one that leads back to the
    // artist, since the head's title is hidden there and the top bar carries no
    // back button. A 38px sticker would have been the smallest tap target on
    // the screen, on the one element the page cannot be left without.
    min-height: $bar-control;

    .back-arrow {
      // arrow.svg already points left, so it needs no rotation — rotating it
      // turned the way BACK into a way forward.
      height: 1.1rem;
      width: 1.1rem;
      flex-shrink: 0;
    }

    // How many releases — the same count chip the queue caption wears, in
    // album lilac rather than track yellow.
    .count {
      @include mem-count-chip("album");
    }

    // The whole sticker is the link, so the pointer flip belongs to the plate
    // (a CUT, like every other pressable surface).
    &:hover {
      background-color: var(--mem-hover);
      color: var(--mem-hover-text);
    }
  }

  // (The `padding: 0 1rem` that stood here would put the tab plate off the
  // page's leading edge (#528), and the `text-transform: capitalize` next to it
  // is dead — the segments set `uppercase` themselves, which beats inheritance.)

  .nothing {
    height: max-content;
    padding-top: 5rem;
  }
}
</style>
