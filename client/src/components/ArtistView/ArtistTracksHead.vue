<template>
  <!-- The head of the artist's "all tracks" page (SEE ALL under Top Tracks).
       Whose tracks these are and the way back to them, how many and how long,
       then Play, the order and a find over the whole list. -->
  <GenericHeader entity="track" class="artist-tracks-head">
    <template #name>All Tracks</template>
    <template #after>
      <!-- Same shape as the discography page's context sticker: on a phone the
           title is hidden and the top bar has no back button, so this is the
           one way back to the artist there — 44px, the whole sticker a link. -->
      <RouterLink
        class="at-context"
        :to="{ name: Routes.artist, params: { hash: artisthash } }"
        :title="name ? `Back to ${name}` : 'Back to the artist'"
      >
        <ArrowSvg class="back-arrow" aria-hidden="true" />
        <img
          v-if="image && !imageFailed"
          class="at-avatar"
          :src="image"
          alt=""
          @error="imageFailed = true"
        />
        <span class="who">{{ name || "Artist" }}</span>
        <span v-if="loaded" class="count">
          {{ count.toLocaleString() }}
          <span class="caps">track{{ count === 1 ? "" : "s" }}</span>
        </span>
        <span v-if="loaded && count" class="length">{{ duration }}</span>
      </RouterLink>

      <div v-if="count" class="at-tools">
        <PlayBtnRect :source="playSources.artist" :action="() => emit('play')" />
        <DropDown
          component_key="artist-tracks-sort"
          :items="ARTIST_TRACK_SORTS"
          :current="current"
          reverse="hide"
          @item-clicked="(item: { key: ArtistTrackSort }) => emit('update:sort', item.key)"
        />
        <ListFind
          :model-value="query"
          field-id="artist-tracks-find"
          :placeholder="name ? `Find in ${name}` : 'Find a track'"
          @update:model-value="(q: string) => emit('update:query', q)"
        />
      </div>

      <p v-if="query && !matches" class="at-nomatch">
        No track matches “{{ query }}”.
      </p>
    </template>
  </GenericHeader>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { playSources } from "@/enums";
import { Routes } from "@/router";
import { ARTIST_TRACK_SORTS, ArtistTrackSort } from "@/utils/artistTracks";

import ArrowSvg from "@/assets/icons/arrow.svg";
import DropDown from "@/components/shared/DropDown.vue";
import GenericHeader from "@/components/shared/GenericHeader.vue";
import ListFind from "@/components/shared/ListFind.vue";
import PlayBtnRect from "@/components/shared/PlayBtnRect.vue";

const props = defineProps<{
  artisthash: string;
  name: string;
  /** Full URL of the artist picture, or "" when there is none (yet). */
  image: string;
  count: number;
  /** Total length, already formatted. */
  duration: string;
  loaded: boolean;
  sort: ArtistTrackSort;
  query: string;
  /** Rows the current find leaves. */
  matches: number;
}>();

const emit = defineEmits<{
  (e: "play"): void;
  (e: "update:sort", sort: ArtistTrackSort): void;
  (e: "update:query", query: string): void;
}>();

const current = computed(() => ARTIST_TRACK_SORTS.find((s) => s.key === props.sort) ?? ARTIST_TRACK_SORTS[0]);

// A new artist (or a picture that arrives later) gets a fresh try.
const imageFailed = ref(false);
watch(
  () => props.image,
  () => (imageFailed.value = false)
);
</script>

<style lang="scss">
.artist-tracks-head {
  // The context sticker — the discography page's `.discog-context`, with the
  // artist's picture in it so the page says whose list this is at a glance.
  .at-context {
    @include mem-sticker;
    display: inline-flex;
    align-items: center;
    gap: $small;
    max-width: 100%;
    min-height: $bar-control;
    font-weight: 600;

    .back-arrow {
      // arrow.svg already points left: no rotation.
      height: 1.1rem;
      width: 1.1rem;
      flex-shrink: 0;
    }

    .at-avatar {
      width: 2rem;
      height: 2rem;
      flex-shrink: 0;
      border-radius: 50%;
      border: $mem-ring-w solid $mem-line;
      object-fit: cover;
    }

    .who {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .count {
      @include mem-count-chip("track");
      flex-shrink: 0;
    }

    .length {
      flex-shrink: 0;
      font-weight: 500;
      opacity: 0.75;
      white-space: nowrap;
    }

    &:hover {
      background-color: var(--mem-hover);
      color: var(--mem-hover-text);
    }
  }

  // Play · order · find. Wraps on a phone; the find takes what is left.
  .at-tools {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: $small;
    margin-top: 1rem;

    > * {
      flex-shrink: 0;
    }

    .smdropdown {
      width: 10rem;
    }

    .list-find {
      flex: 1 1 14rem;
      min-width: 0;
      max-width: 24rem;
      margin-left: auto;
    }
  }

  .at-nomatch {
    @include mem-sticker;
    display: inline-block;
    margin: 1rem 0 0;
    font-weight: 500;
  }

  @include allPhones {
    .at-context .length {
      display: none;
    }

    .at-tools .list-find {
      max-width: none;
      margin-left: 0;
    }
  }
}

// The head is the scroller's #before: give it the rows' bottom air.
.artist-tracks-page .vue-recycle-scroller__slot .artist-tracks-head {
  padding-bottom: 1rem;
}
</style>
