<template>
  <div class="continue-card" :class="`ent-${entry.type}`">
    <RouterLink class="cover" :to="link">
      <img v-if="image" :src="image" alt="" />
      <div v-else class="glyph" v-html="entry.type === 'album' ? AlbumIcon : PlaylistIcon"></div>
    </RouterLink>
    <div class="info">
      <span class="kicker">Continue listening</span>
      <RouterLink class="name ellip" :to="link">{{ name }}</RouterLink>
      <div class="meta">
        {{ entry.type === 'album' ? 'Album' : 'Playlist' }} · Track {{ position }} of {{ total }}
        <template v-if="entry.item?.time"> · {{ entry.item.time }}</template>
      </div>
      <div class="progress" role="progressbar" :aria-valuenow="position" :aria-valuemax="total">
        <span :style="{ width: progress + '%' }"></span>
      </div>
      <button class="btn-primary resume" @click="resume">
        <PlaySvg />
        Continue
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";

import { paths } from "@/config";
import { playAlbumAt, playPlaylistAt } from "@/helpers/usePlayFrom";
import { AlbumIcon, PlaylistIcon } from "@/icons";
import { Routes } from "@/router";

import PlaySvg from "@/assets/icons/play.svg";

// One item of the homepage's `continue_listening` row: the album or playlist
// the user was last in and did not finish. The server sends it like every
// other row item — `{type, item}` with the recovered album/playlist card — and
// adds `track_index` (0-based, the track they were on), `track_total` and
// `time` ("2 hours ago") to `item`.
// `item` is optional in HomePageItem's type; the server always sends it for
// this row, and the computeds below guard it anyway.
const props = defineProps<{
  entry: {
    type: string;
    item?: any;
  };
}>();

const position = computed(() => (props.entry.item?.track_index ?? 0) + 1);
const total = computed(() => props.entry.item?.track_total || 1);
// Album: its hash. Playlist: its id (the server sends it as text).
const hash = computed(() =>
  String(props.entry.type === "album" ? props.entry.item?.albumhash : props.entry.item?.id)
);
const progress = computed(() => Math.round((position.value / total.value) * 100));

const name = computed(() => props.entry.item?.title ?? props.entry.item?.name ?? "");

const image = computed(() => {
  const item = props.entry.item;
  if (!item) return "";
  if (props.entry.type === "album") return item.image ? paths.images.thumb.large + item.image : "";
  return item.thumb ? paths.images.playlist + item.thumb : "";
});

const link = computed(() =>
  props.entry.type === "album"
    ? { name: Routes.album, params: { albumhash: hash.value } }
    : { name: Routes.playlist, params: { pid: hash.value } }
);

function resume() {
  // Resume ON the track they were on: it may have been cut off mid-way.
  const index = props.entry.item?.track_index ?? 0;
  const trackhash = props.entry.item?.resume_trackhash;
  if (props.entry.type === "album") playAlbumAt(hash.value, index, trackhash);
  else playPlaylistAt(hash.value, index, trackhash);
}
</script>

<style lang="scss">
// The one big card on Home. Same anatomy as every plate (ink frame, hatch,
// hard offset), filled with the entity's pastel like a browse tile, so an
// album reads lavender and a playlist pink before the name is read.
.continue-card {
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 1.25rem;
  align-items: center;
  padding: 1rem;
  margin-bottom: 2rem;
  --row-fill: #{$mem-panel};
  @include candy-box(var(--row-fill), $candy-radius);
  @include mem-hatch(38px, $on: accent);
  @include candy-shadow(4px, 4px);
  color: $mem-ink;

  @each $name in album, playlist {
    &.ent-#{$name} {
      --row-fill: #{mem-pastel(map-get($mem-entities, $name))};
    }
  }

  .cover {
    width: 8.5rem;
    aspect-ratio: 1;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    overflow: hidden;
    background-color: $mem-panel;

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }

    .glyph {
      width: 100%;
      height: 100%;
      display: grid;
      place-items: center;

      svg {
        width: 3rem;
        height: 3rem;
      }
    }
  }

  .info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 0.35rem;
    min-width: 0;
  }

  // Covers on the hatch, like every label on a hatched plate.
  .kicker,
  .name,
  .meta {
    @include mem-hatch-clear(6px);
    max-width: 100%;
  }

  .kicker {
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .name {
    font-size: 1.35rem;
    font-weight: 700;
    color: inherit;
  }

  .meta {
    font-size: 0.85rem;
  }

  .progress {
    width: min(100%, 22rem);
    height: 0.6rem;
    border: $mem-ring-w solid $mem-ink;
    border-radius: $candy-radius-pill;
    background-color: $mem-panel-static;
    overflow: hidden;
    margin: 0.25rem 0 0.4rem;

    span {
      display: block;
      height: 100%;
      background-color: $mem-ink;
    }
  }

  .resume {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;

    svg {
      width: 1.1rem;
      height: 1.1rem;
    }
  }

  @include allPhones {
    grid-template-columns: 5.5rem minmax(0, 1fr);
    gap: 0.85rem;

    .cover {
      width: 5.5rem;
    }

    .name {
      font-size: 1.05rem;
    }
  }
}
</style>
