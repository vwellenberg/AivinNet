<template>
  <div class="homebrowse">
    <div class="btitle"><b>Browse Library</b></div>
    <div class="browselist">
      <RouterLink
        v-for="crate in crates"
        :key="crate.entity"
        class="browseitem rounded-sm"
        :class="`ent-${crate.entity}`"
        :to="{ name: crate.route }"
      >
        <div class="label">
          <span class="name">{{ crate.title }}</span>
          <span v-if="crate.total !== null" class="count">{{ crate.countLabel }}</span>
        </div>
        <!-- A fan of what lies behind the card: the three newest albums, the
             three most-played artists. Decoration — the card's name says
             where it goes, so the pictures carry no alt text. -->
        <div v-if="crate.images.length" class="fan" :class="{ round: crate.entity === 'artist' }" aria-hidden="true">
          <img v-for="(src, i) in crate.images" :key="i" :src="src" alt="" draggable="false" loading="lazy" />
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<script lang="ts">
import { reactive } from "vue";

type CrateEntity = "album" | "artist";

interface CrateData {
  total: number | null;
  images: string[];
}

// Module scope (a plain <script>, not <script setup>, which runs per
// instance): a return to Home shows the crates at once instead of name-only
// cards that fill in after the arrival animation; one request pair per
// session, and again after a failure. A count that grows while the app is
// open shows on the next reload.
const data = reactive<Record<CrateEntity, CrateData>>({
  album: { total: null, images: [] },
  artist: { total: null, images: [] },
});

/** Tests only: forget what was loaded. */
export function __resetBrowseCrates() {
  for (const crate of Object.values(data)) {
    crate.total = null;
    crate.images = [];
  }
}
</script>

<script setup lang="ts">
import { computed, onMounted } from "vue";

import { paths } from "@/config";
import { getAllItems } from "@/requests/getall";
import { Routes } from "@/router";

// Home's way into the two library lists (Albums and Artists have no
// navigation entry since 2026-11-14). A "crate" per list: its name, how many
// there are, and a fan of three pictures from it — the user picked this over
// four plain bars ("so irgendwie etwas lahm"). Playlists and Favorites are
// not here: they keep their navigation entries.

const crates = computed(() => [
  {
    entity: "album" as const,
    title: "Albums",
    route: Routes.AlbumList,
    ...data.album,
    countLabel: countLabel(data.album.total, "album"),
  },
  {
    entity: "artist" as const,
    title: "Artists",
    route: Routes.ArtistList,
    ...data.artist,
    countLabel: countLabel(data.artist.total, "artist"),
  },
]);

function countLabel(total: number | null, noun: string) {
  if (total === null) return "";
  return `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
}

type Item = { image?: string; help_text?: string };

async function fetchThree(type: "albums" | "artists", sortby: string) {
  const res = await getAllItems(type, { start: 0, limit: 3, sortby, reverse: "1" });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.items)) return null;
  return { total: res.data.total, items: res.data.items as Item[] };
}

// Three of each, through the list endpoint the pages themselves use: the
// newest albums (what came in last is what one looks for), the most-played
// artists — or, while nothing has been played yet (every count is 0 and the
// order would be arbitrary), the newest artists too. A failed request leaves
// the card as name only: still a working link, nothing half-drawn.
async function load(entity: CrateEntity) {
  try {
    let page =
      entity === "album" ? await fetchThree("albums", "created_date") : await fetchThree("artists", "playcount");
    if (entity === "artist" && page && page.items.every((it) => /^0 play/.test(it.help_text || ""))) {
      page = await fetchThree("artists", "created_date");
    }
    if (!page) return;

    const base = entity === "album" ? paths.images.thumb.medium : paths.images.artist.medium;
    data[entity].total = typeof page.total === "number" ? page.total : null;
    data[entity].images = page.items.filter((it) => it.image).map((it) => base + it.image);
  } catch {
    // Decoration only: the card works without it.
  }
}

onMounted(() => {
  if (data.album.total === null) load("album");
  if (data.artist.total === null) load("artist");
});
</script>

<style lang="scss">
.homebrowse {
  // No horizontal padding: the caption sticker and the tiles sit on the
  // page's own content edge — the same line the card rows below start on.
  // An extra indent here put the whole block 8px right of everything else.
  // The top value is the page's own rhythm under the head. On a phone that
  // head is empty but still owns the page start ($phone-page-start), so this
  // padding stands down there — two owners would stack to 48px, which is the
  // drift the token was introduced to end.
  padding: $phone-page-start 0 1.5rem;

  @include allPhones {
    padding-top: 0;
  }

  .btitle {
    // A sticker, like every other section caption: it stood free on the doodle
    // ground, where the shape behind it decided how well it read.
    @include mem-sticker;
    font-size: 1.15rem;
    font-weight: 700;
    margin-bottom: 1rem;
  }

  // Two equal columns, so the two crates are ONE size. A free-wrapping flex
  // row sized each tile by itself.
  .browselist {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 1.5rem;
    margin-top: $small;
  }

  .browseitem {
    // The column sets the width (see .browselist).
    min-width: 0;
    font-weight: 500;
    padding: 1.25rem 1rem;
    // A pressable card carries the hatch (#378). The label sits on a smooth
    // cover patch that reads the same `--row-fill` as the card itself, so a
    // fill swap can never split surface and cover — the mem-row-plate pattern.
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius-sm);
    @include mem-hatch(38px, $on: surface);
    // Hard offset shadow: the tile sits above the grid ground (memphis).
    @include candy-raised(3px, 3px, $press: false);
    color: $candy-text;
    transition: background-color $motion-move ease-out, color $motion-move ease-out, box-shadow $motion-shadow ease-out;

    // Die Kacheln kommen an wie die Kachelraster darunter (#143 / #162): zwei
    // Platten nebeneinander, die vorher als einziger Block der Startseite
    // sofort dastanden, während die Reihen darunter eintrafen.
    //
    // `mem-arrival` und nicht `btn-pop`, obwohl das hier Bedienelemente sind:
    // Der Pop ist für den 44-px-Satz gebaut. Diese Platte ist 160×70 und trägt
    // Schraffur und harten Schatten, also die Kachel-Anatomie — auf ihr liest
    // sich der Überschwinger als Wackeln, gemessen an denselben Kacheln in #162.
    @include mem-arrival;

    // The crate: name and count top left, the fan of pictures leaning out of
    // the bottom right edge (the card clips it, like a crate's front board).
    position: relative;
    overflow: hidden;
    height: 12rem;
    display: block;

    .label {
      position: relative;
      z-index: 1;
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: $smaller;
      @include mem-hatch-clear(4px);
    }

    .name {
      font-family: inherit;
      font-size: 1.6rem;
      font-weight: 700;
      line-height: 1.1;
    }

    // The count wears the bar's pill: ink frame on panel, so it reads on any
    // entity tint and on the hover plate alike.
    .count {
      font-size: 0.85rem;
      font-weight: 700;
      padding: 0.1rem 0.6rem;
      border: $mem-ring-w solid $mem-ink;
      border-radius: $candy-radius-pill;
      background-color: $mem-panel-static;
      color: $mem-ink;
    }

    // Three pictures, fanned: each one is a little sticker of its own (ink
    // frame, hard offset), the middle one lifted. Pinned to the bottom right
    // and half out of the card, so the stack reads as standing IN the crate.
    .fan {
      position: absolute;
      right: 1rem;
      bottom: -0.6rem;
      width: 15rem;
      height: 9rem;
      pointer-events: none;

      img {
        position: absolute;
        bottom: 0;
        width: 7rem;
        height: 7rem;
        object-fit: cover;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        box-shadow: mem-shadow(3px, 3px);
        // No background of its own: a placeholder cover is a transparent tile
        // that Global/cover-placeholders.scss tints by its route.

        &:nth-child(1) { left: 0; transform: rotate(-12deg); }
        &:nth-child(2) { left: 4rem; bottom: 0.9rem; transform: rotate(-3deg); }
        &:nth-child(3) { left: 8rem; transform: rotate(8deg); }
      }

      &.round img {
        border-radius: 50%;
      }
    }
  }

  // Colour coding: the card's FILL is its entity's pastel tint from the
  // shared palette — the same lavender/lime an album or artist wears in the
  // card rows. The shadow stays ink like every other plate; colour lives on
  // the surface, not the edge. Through `--row-fill`, so the cover under the
  // label takes the same tint (one source, see mem-hatch-clear). The tint is static, so the
  // hatch switches to the accent sprite (ink strokes in both themes) and the
  // text to static ink. Placed BEFORE the hover rule: same specificity, so the
  // hover flip below still wins by order.
  @each $name in album, artist {
    .browseitem.ent-#{$name} {
      --row-fill: #{mem-pastel(map-get($mem-entities, $name))};
      @include mem-hatch(38px, $on: accent);
      color: $mem-ink;
    }
  }

  .browseitem:hover {
    --row-fill: var(--mem-hover);
    background-color: var(--mem-hover);
    // The hatch answers the fill (#422): paper strokes on the dark plate in
    // light mode, ink strokes on the paper plate in dark mode.
    background-image: var(--mem-hatch-hover);
    // The text token travels with the fill (#422) — the fill is the contrast
    // surface now, so without this the tile is an unreadable solid plate.
    color: var(--mem-hover-text);
  }

  // A narrow desktop column (901–1200px, sidebar open: ~280px a card): the
  // fixed 15rem fan would reach under the name and count, so it shrinks
  // from its bottom-right anchor.
  @media only screen and (min-width: 901px) and (max-width: 1200px) {
    .browseitem .fan {
      transform: scale(0.75);
      transform-origin: bottom right;
    }
  }

  // Phones: the two crates side by side, each smaller, the fan scaled down
  // with it (its anchor is the card's bottom right, so it stays in place).
  @include mediumPhones {
    .browselist {
      gap: 0.75rem;
    }

    .browseitem {
      width: auto;
      height: 9rem;
      padding: 0.9rem 0.75rem;

      .name {
        font-size: 1.2rem;
      }

      .fan {
        right: 0.25rem;
        transform: scale(0.55);
        transform-origin: bottom right;
      }
    }
  }
}
</style>
