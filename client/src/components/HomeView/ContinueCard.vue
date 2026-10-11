<template>
  <!-- The wrapper is the size container: the "Up next" column appears only
       when the CARD is wide enough, whatever the window or sidebars do. -->
  <div class="continue-wrap">
  <div class="continue-card" :class="`ent-${entry.type}`">
    <RouterLink class="cover" :to="link">
      <!-- A playlist without its own picture shows the album collage, exactly
           like its card in the rows below (PlaylistCard.vue). -->
      <PlaylistImages v-if="collage.length" :images="collage" size="large" />
      <img v-else-if="image" :src="image" alt="" />
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
        <!-- `.text` lifts the label above the button's sprinkle (btn-primary). -->
        <span class="text">Continue</span>
      </button>
    </div>
    <ol v-if="upNext.length" class="up-next">
      <li class="kicker">Up next</li>
      <li v-for="row in upNext" :key="row.track.trackhash">
        <button class="next-row" :class="{ current: row.current }" @click="playTrack(row.track)">
          <span class="glyph" v-html="row.current ? PlayIcon : NoteIcon"></span>
          <span class="words">
            <b class="title ellip">{{ row.track.title }}</b>
            <span v-if="row.track.artists?.length" class="artist ellip">{{
              row.track.artists.map(a => a.name).join(", ")
            }}</span>
          </span>
          <span v-if="row.track.duration" class="dur">{{ formatSeconds(row.track.duration) }}</span>
        </button>
      </li>
    </ol>
  </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { paths } from "@/config";
import { playAlbumAt, playPlaylistAt, resumeIndex } from "@/helpers/usePlayFrom";
import { AlbumIcon, PlayIcon, PlaylistIcon } from "@/icons";
import { Track } from "@/interfaces";
import { getAlbumTracks } from "@/requests/album";
import { getPlaylist } from "@/requests/playlists";

import PlaylistImages from "@/components/shared/PlaylistImages.vue";
import NoteIcon from "@/assets/icons/note.svg?raw";
import { Routes } from "@/router";
import formatSeconds from "@/utils/useFormatSeconds";

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

const collage = computed(() => {
  const item = props.entry.item;
  return props.entry.type === "playlist" && item && !item.has_image && item.images?.length ? item.images : [];
});

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

// "Up next": the track they were on and the two after it. Loaded once per
// card: an album is small and comes whole; a playlist can be huge, so only a
// window around the position is asked for, and the track is found by its hash
// inside it (the server's index can be off by orphans, see resumeIndex).
const UP_NEXT = 3;
const upNext = ref<{ track: Track; current: boolean }[]>([]);

async function loadUpNext() {
  const item = props.entry.item;
  if (!item) return;

  const index = item.track_index ?? 0;
  let tracks: Track[] = [];
  let offset = 0;

  if (props.entry.type === "album") {
    tracks = await getAlbumTracks(hash.value);
  } else {
    offset = Math.max(0, index - 3);
    const data = await getPlaylist(hash.value, false, offset, 10);
    tracks = data?.tracks ?? [];
  }

  if (!tracks.length) return;

  const at = resumeIndex(tracks, item.resume_trackhash, index - offset);
  // No position number in front of the title: many titles carry their own
  // track number ("19. Rittersleut"), and "3 · 19. …" read as noise.
  upNext.value = tracks.slice(at, at + UP_NEXT).map((track, i) => ({ track, current: i === 0 }));
}

// A primitive key: a getter that builds a new array is "changed" every time
// it re-runs, and every Home fetch hands in a fresh entry object — so each
// visit (and each window widen) refetched the whole album for an equal entry.
watch(
  () => `${props.entry.type}|${hash.value}|${props.entry.item?.resume_trackhash ?? ''}`,
  loadUpNext,
  { immediate: true }
);

function playTrack(track: Track) {
  const index = props.entry.item?.track_index ?? 0;
  if (props.entry.type === "album") playAlbumAt(hash.value, index, track.trackhash);
  else playPlaylistAt(hash.value, index, track.trackhash);
}

function resume() {
  // Resume ON the track they were on: it may have been cut off mid-way.
  const index = props.entry.item?.track_index ?? 0;
  const trackhash = props.entry.item?.resume_trackhash;
  if (props.entry.type === "album") playAlbumAt(hash.value, index, trackhash);
  else playPlaylistAt(hash.value, index, trackhash);
}
</script>

<style lang="scss">
// The one big card on Home. Same frame and offset as every plate, filled with
// the entity's pastel like a browse tile, so an
// album reads lavender and a playlist pink before the name is read.
// Each card is its own size container for the Up next column; the spacing
// to the rows below belongs to the row of cards (HomeView/main.vue).
.continue-wrap {
  container-type: inline-size;
}

.continue-card {
  // The arrival (reported 2026-10-07: "no animation when it appears, or a very
  // subtle one"). It had none of its own — the only movement was the page's
  // 22px slide, and on a fetch that finished after it, not even that. The
  // biggest object on Home now arrives like a plate rising out of the page,
  // then its moving parts follow in reading order: the progress fill runs to
  // its value, Continue pops, the Up next rows step in. All of it on the
  // shared vocabulary (Global/_button-classes.scss), nothing local.
  animation: mem-plate-rise $motion-settle ease-out;
  display: grid;
  grid-template-columns: 8.5rem minmax(0, 1fr);
  gap: 1.25rem;
  align-items: center;
  padding: 1rem;
  position: relative;
  --row-fill: #{$mem-panel};
  @include candy-box(var(--row-fill), $candy-radius);
  @include candy-shadow(4px, 4px);
  color: $mem-ink;

  // Dots, not hatch. The card is read; what can be pressed on it (cover, title,
  // Continue, the rows) carries its own plate, and the hatch says "pressable"
  // (styling.md). The dots cover the whole plate evenly: the labels sit on their
  // own covers, so no dot lands under a letter. The children sit above the dots.
  &::before {
    @include mem-halftone($reach: null);
  }

  > * {
    position: relative;
    z-index: 1;
  }

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

  // A plain cover under each label keeps the dots off the letters.
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
      // Runs from the left to where they are, once the plate is up.
      transform-origin: left;
      animation: mem-fill-grow $motion-settle $motion-curve-settle $motion-after-plate backwards;
    }
  }

  .resume {
    // A primary that mounts once per visit opts into the pop at its call site
    // (btn-primary carries none, see Global/_buttons.scss) — after the fill.
    @include btn-pop;
    --btn-pop-delay: #{$motion-after-plate + $motion-stagger};
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    // No svg size here: the glyph is the role's (`$glyph`, 1.75rem), the same
    // ▶ as the player bar's play button and the header "Play". It was shrunk
    // to 1.1rem at this call site, and the Continue button read as the small
    // one next to every other play control ("play icon too small?", user
    // 2026-10-09). Census: primaryGlyph.test.ts.
  }

  // "Up next" only where the card has room for a third column; below that the
  // list simply is not there (a narrow card stays the two-column card).
  .up-next {
    display: none;
  }

  @container (min-width: 760px) {
    grid-template-columns: 8.5rem minmax(0, 1fr) minmax(0, 1.15fr);

    .up-next {
      display: flex;
    }
  }

  .up-next {
    flex-direction: column;
    // Room for each row's 3px offset shadow.
    gap: 0.5rem;
    list-style: none;
    margin: 0;
    padding: 0;
    min-width: 0;

    // The list arrives top-down, its caption first — as rows, so `drop`. The
    // `<ol>` holds nothing but these `<li>`, so `:nth-child` counts only them.
    // No wait for the plate: the rows need a request of their own and mount
    // after the card has landed anyway (measured: the album's tracks came in
    // after the rise had finished).
    > li {
      @include mem-arrival($beyond: drop);
    }

    .kicker {
      align-self: flex-start;
    }

    // A small song row, in the anatomy every other track list uses: title
    // bold, artist muted beside it, duration in its pill — on a pressable row
    // plate (ink frame, offset shadow). It was a thin-ringed strip with
    // "Title — Artist" in one run, which read as an input field, not as rows
    // (user, 2026-10-06). No hatch: a content list does not wear it.
    // The fill stays the static panel: the card under it is a static pastel.
    .next-row {
      @include mem-row-plate($hatch: false);
      --row-fill: #{$mem-panel-static};
      color: $mem-ink;
      width: 100%;
      display: flex;
      align-items: center;
      // Buttons centre their content app-wide; a list row reads from the left.
      justify-content: flex-start;
      gap: 0.6rem;
      padding: 0.4rem 0.6rem;
      font-size: 0.85rem;
      text-align: left;
      cursor: pointer;

      // One 1rem box for every row's glyph, so all rows keep one height.
      .glyph {
        flex-shrink: 0;
        display: grid;
        place-items: center;
        width: 1rem;
        height: 1rem;

        svg {
          width: 1rem;
          height: 1rem;
        }
      }

      // The ▶ is the TRANSPORT glyph, drawn for a 44px button: 13 of its 24
      // units are ink. The ♪ under it is from the chrome set, 17 of 24. In
      // one box size the ▶ read a quarter smaller than the ♪ right below it
      // ("play icon too small?", user 2026-10-09). 17/13 = 1.3 gives both the
      // same ink height. The negative margin keeps its layout size at the
      // 1rem box (so the row does not grow) and spreads the overflow evenly:
      // a grid cell aligns an oversized item to its START, which sat the ▶
      // 2.4px low (measured).
      &.current .glyph svg {
        width: 1.3rem;
        height: 1.3rem;
        margin: -0.15rem;
      }

      .words {
        display: flex;
        align-items: baseline;
        gap: 0.5rem;
        min-width: 0;
        flex: 1;
      }

      .title {
        flex-shrink: 1;
        min-width: 0;
      }

      .artist {
        flex-shrink: 2;
        min-width: 0;
        font-size: 0.8rem;
        opacity: 0.7;
      }

      .dur {
        flex-shrink: 0;
        margin-left: auto;
        padding: 0 0.45rem;
        border: $mem-ring-w solid currentColor;
        border-radius: 999px;
        font-size: 0.72rem;
        font-variant-numeric: tabular-nums;
      }

      @media (hover: hover) {
        &:hover {
          @include mem-row-plate-hover($hatch: false);
        }
      }
    }
  }

  // Once risen, it stays risen — the latch the rows have (utils/arrivalLatch.ts
  // marks the card). The cards are a keyed `v-for`: when a refetch reorders
  // them, Vue moves the node and every animation inside restarts with it.
  &[data-arrived] {
    animation: none;

    .progress span,
    .resume {
      animation: none;
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
