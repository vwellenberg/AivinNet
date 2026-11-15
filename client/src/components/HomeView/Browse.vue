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
        <!-- A row of record sleeves standing in the crate: the newest albums,
             the most-played artists (or the newest, see `order`). Every fetched
             picture is rendered; the card's width decides how many show (CSS
             container queries), so the rest are display:none. Decoration — the
             card's name says where it goes, so the pictures carry no alt text. -->
        <div v-if="crate.images.length" class="covers" :class="{ round: crate.entity === 'artist' }" aria-hidden="true">
          <img v-for="(src, i) in crate.images" :key="i" :src="src" alt="" draggable="false" loading="lazy" />
        </div>
        <!-- The crate's front board: the label says what the row is. -->
        <div v-if="crate.images.length" class="board" aria-hidden="true">
          <span class="tag">{{ crate.tag }}</span>
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<script lang="ts">
import { reactive } from "vue";

type CrateEntity = "album" | "artist";
// How the shown pictures were chosen. Albums are always the newest; artists
// are the most-played, or the newest while nothing has been played yet.
type Order = "newest" | "most-played";

interface CrateData {
  total: number | null;
  images: string[];
  order: Order;
}

const FIRST_ORDER: Record<CrateEntity, Order> = { album: "newest", artist: "most-played" };

// Module scope (a plain <script>, not <script setup>, which runs per
// instance): a return to Home shows the crates at once instead of name-only
// cards that fill in after the arrival animation; one request pair per
// session, and again after a failure. A count that grows while the app is
// open shows on the next reload.
const data = reactive<Record<CrateEntity, CrateData>>({
  album: { total: null, images: [], order: FIRST_ORDER.album },
  artist: { total: null, images: [], order: FIRST_ORDER.artist },
});

/** Tests only: forget what was loaded. */
export function __resetBrowseCrates() {
  for (const entity of Object.keys(data) as CrateEntity[]) {
    data[entity].total = null;
    data[entity].images = [];
    data[entity].order = FIRST_ORDER[entity];
  }
}
</script>

<script setup lang="ts">
import { computed, onMounted } from "vue";

import { paths } from "@/config";
import { getAllItems } from "@/requests/getall";
import { Routes } from "@/router";

// Home's way into the two library lists (Albums and Artists have no
// navigation entry since 2026-11-14). Each card is a record crate: its name,
// how many there are, a row of sleeves standing in it, and a front board
// that says what the row is. The user picked this from a preview on
// 2026-11-15 ("Kacheln wirken auf größeren Bildschirmen leer" — the old
// three-picture fan left wide cards empty). Playlists and Favorites are not
// here: they keep their navigation entries.

const SHOWN_MAX = 7;

const crates = computed(() => [
  {
    entity: "album" as const,
    title: "Albums",
    route: Routes.AlbumList,
    ...data.album,
    countLabel: countLabel(data.album.total, "album"),
    tag: tagFor(data.album.order),
  },
  {
    entity: "artist" as const,
    title: "Artists",
    route: Routes.ArtistList,
    ...data.artist,
    countLabel: countLabel(data.artist.total, "artist"),
    tag: tagFor(data.artist.order),
  },
]);

function countLabel(total: number | null, noun: string) {
  if (total === null) return "";
  return `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
}

function tagFor(order: Order) {
  return order === "newest" ? "NEW IN" : "MOST PLAYED";
}

type Item = { image?: string; help_text?: string };

async function fetchSeven(type: "albums" | "artists", sortby: string) {
  const res = await getAllItems(type, { start: 0, limit: SHOWN_MAX, sortby, reverse: "1" });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.items)) return null;
  return { total: res.data.total, items: (res.data.items as Item[]).slice(0, SHOWN_MAX) };
}

// Seven of each, through the list endpoint the pages themselves use: the
// newest albums (what came in last is what one looks for), the most-played
// artists — or, while nothing has been played yet (every count is 0 and the
// order would be arbitrary), the newest artists too. A failed request leaves
// the card as name only: still a working link, nothing half-drawn.
async function load(entity: CrateEntity) {
  try {
    let order: Order = FIRST_ORDER[entity];
    let page =
      entity === "album" ? await fetchSeven("albums", "created_date") : await fetchSeven("artists", "playcount");
    if (entity === "artist" && page && page.items.every((it) => /^0 play/.test(it.help_text || ""))) {
      page = await fetchSeven("artists", "created_date");
      order = "newest";
    }
    if (!page) return;

    const base = entity === "album" ? paths.images.thumb.medium : paths.images.artist.medium;
    data[entity].total = typeof page.total === "number" ? page.total : null;
    data[entity].images = page.items.filter((it) => it.image).map((it) => base + it.image);
    data[entity].order = order;
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

    // The card is a container: the row of sleeves below asks the card's own
    // width (not the viewport's) how many of its pictures fit.
    container-type: inline-size;

    // The crate: name and count top left, a row of sleeves standing in it
    // from the bottom right, and the front board across the bottom.
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

    // The row of record sleeves standing in the crate: a right-aligned flex
    // row, each cover a sticker of its own (ink frame, hard offset), each
    // overlapping the one before it and tilted and lifted a little differently.
    // Later ones paint above earlier ones (DOM order). The row's bottom edge
    // sits 1.2rem up, so the lower part of the covers hides behind the board.
    .covers {
      position: absolute;
      right: 1rem;
      bottom: 1.2rem;
      display: flex;
      justify-content: flex-end;
      align-items: flex-end;
      pointer-events: none;

      img {
        position: relative;
        flex: 0 0 7.5rem;
        width: 7.5rem;
        height: 7.5rem;
        // Step of 3.9rem between covers: 7.5rem wide, pulled 3.6rem back.
        margin-left: -3.6rem;
        object-fit: cover;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        box-shadow: mem-shadow(3px, 3px);
        // No background of its own: a placeholder cover is a transparent tile
        // that Global/cover-placeholders.scss tints by its route.

        &:first-child {
          margin-left: 0;
        }

        // Tilt and lift, one per slot.
        &:nth-child(1) { transform: rotate(-5deg); }
        &:nth-child(2) { transform: translateY(-10px) rotate(3deg); }
        &:nth-child(3) { transform: translateY(-4px) rotate(-2deg); }
        &:nth-child(4) { transform: translateY(-14px) rotate(4deg); }
        &:nth-child(5) { transform: translateY(-2px) rotate(-4deg); }
        &:nth-child(6) { transform: translateY(-8px) rotate(2deg); }
        &:nth-child(7) { transform: rotate(-3deg); }

        // Hidden until the card is wide enough for them (see the queries below).
        &:nth-child(n + 4) {
          display: none;
        }
      }

      // Artists stand as round portraits, not sleeves.
      &.round img {
        border-radius: 50%;
      }
    }

    // The board: the crate's front edge, full width, across the bottom. It
    // paints over the covers' lower part. Its fill is a darker shade of the
    // card's own fill, read through `--row-fill`, so the hover swap carries over.
    .board {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      height: 2.5rem;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      padding: 0 1rem;
      border-top: $candy-border;
      background-color: color-mix(in srgb, var(--row-fill) 75%, #{$mem-ink});
      pointer-events: none;
    }

    // The label on the board: a small white ticket with an ink frame.
    .tag {
      padding: 0.15rem 0.5rem;
      border: $mem-ring-w solid $mem-ink;
      border-radius: 5px;
      background-color: $mem-panel-static;
      color: $mem-ink;
      font-size: 0.72rem;
      font-weight: 700;
      letter-spacing: 0.16em;
      line-height: 1.3;
      white-space: nowrap;
    }

    // How many sleeves show, by the card's CONTENT width (a container query
    // measures the content box, so the 1rem padding on each side is not
    // counted). Each cover steps 3.9rem; the row must end at least ~8rem right
    // of the card's left edge, or it runs under the name and count. Estimated
    // from the font metrics, not yet measured in a browser: 3 covers are 15.3rem
    // wide, 4 are 19.2rem, 5 are 23.1rem, 6 are 27rem, 7 are 30.9rem. The
    // thresholds sit a little above the bare arithmetic.
    @container (min-width: 430px) {
      .covers img:nth-child(4) { display: block; }
    }
    @container (min-width: 490px) {
      .covers img:nth-child(5) { display: block; }
    }
    @container (min-width: 550px) {
      .covers img:nth-child(6) { display: block; }
    }
    @container (min-width: 620px) {
      .covers img:nth-child(7) { display: block; }
    }

    // A narrow card (the 901–1200px sidebar column is one): three full sleeves
    // would reach up under the count pill, so the row shrinks from its
    // bottom-right anchor and clears it vertically. This replaces the old
    // viewport-width rule for 901–1200px: it asked the viewport, but what
    // decides the overlap is the card's own width.
    @container (max-width: 360px) {
      .covers {
        transform: scale(0.6);
        transform-origin: bottom right;
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

  // Phones: the two crates side by side, each smaller. The row is scaled down
  // from its bottom-right anchor, so it stays in the card's corner, and the
  // board and its label shrink with the card. The card stays 9rem tall. The
  // narrow-card container rule above also applies here; this block comes later
  // and wins with the phone's own scale.
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

      .covers {
        right: 0.75rem;
        transform: scale(0.55);
        transform-origin: bottom right;
      }

      .board {
        height: 1.8rem;
        padding: 0 0.75rem;
      }

      .tag {
        font-size: 0.6rem;
        letter-spacing: 0.08em;
      }
    }
  }
}
</style>
