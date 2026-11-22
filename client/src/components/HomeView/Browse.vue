<template>
  <div class="homebrowse">
    <div class="btitle"><b>Browse Library</b></div>
    <div ref="list" class="browselist">
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
        <!-- A fan of record sleeves standing in the crate, across the whole card
             (utils/crateFan.ts decides how many and where, from the card's measured
             size). Decoration — the card's name says where it goes, so the pictures
             carry no alt text. -->
        <div
          v-if="crate.images.length"
          class="covers"
          :class="{ round: crate.entity === 'artist', unmeasured: cardWidth === 0 }"
          :style="{ height: crate.fan.size + 'px' }"
          aria-hidden="true"
        >
          <img
            v-for="(slot, i) in crate.fan.slots"
            :key="i"
            :src="crate.images[i]"
            :style="{
              left: slot.left + 'px',
              bottom: slot.lift + 'px',
              width: crate.fan.size + 'px',
              height: crate.fan.size + 'px',
              transform: `rotate(${slot.rotate}deg)`,
            }"
            alt=""
            draggable="false"
            loading="lazy"
          />
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
// How the shown pictures were chosen. Albums are the newest, or the
// most-played while fewer than NEW_IN_MIN of the newest have a cover; artists
// are the most-played, or the newest while no played artist has a picture yet.
type Order = "newest" | "most-played";

interface CrateData {
  total: number | null;
  images: string[];
  order: Order;
}

const FIRST_ORDER: Record<CrateEntity, Order> = { album: "newest", artist: "most-played" };

// How far back the newest albums are read for covers, in ONE request: the most
// the list endpoint answers `artwork` for (`ARTWORK_LIMIT_MAX` in
// api/getall/__init__.py; a test holds the two together).
export const NEWEST_ALBUMS = 50;

// How many of the newest albums need a cover before the crate says NEW IN.
// One or two new covers in the fan read as an empty crate with a stray
// sleeve; below this the most-played albums stand in (2026-11-22).
export const NEW_IN_MIN = 3;

// Module scope (a plain <script>, not <script setup>, which runs per
// instance): a return to Home shows the crates at once instead of name-only
// cards that fill in after the arrival animation; one set of list requests per
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
import { useElementSize } from "@vueuse/core";
import { computed, onMounted, ref, watch } from "vue";

import { paths } from "@/config";
import { getAllItems } from "@/requests/getall";
import { Routes } from "@/router";
import { crateFan } from "@/utils/crateFan";

// Home's way into the two library lists (Albums and Artists have no
// navigation entry since 2026-11-14). Each card is a record crate: its name,
// how many there are, a fan of sleeves standing in it across the whole card,
// and a front board that says what the row is. Playlists and Favorites are
// not here: they keep their navigation entries.

// Asked for more than shown: an item the server flags without artwork is
// dropped (see `load`), and the rest make up the row.
const FETCH_LIMIT = 16;
const SHOWN_MAX = 12;

const crates = computed(() => [
  {
    entity: "album" as const,
    title: "Albums",
    route: Routes.AlbumList,
    ...data.album,
    countLabel: countLabel(data.album.total, "album"),
    tag: tagFor(data.album.order),
    fan: crateFan(data.album.images.length, cardWidth.value, cardHeight.value),
  },
  {
    entity: "artist" as const,
    title: "Artists",
    route: Routes.ArtistList,
    ...data.artist,
    countLabel: countLabel(data.artist.total, "artist"),
    tag: tagFor(data.artist.order),
    fan: crateFan(data.artist.images.length, cardWidth.value, cardHeight.value),
  },
]);

// The card size the fan is laid out against, measured on the first card
// whenever the list resizes: the card is 12rem tall on desktop, 9rem on phones.
const list = ref<HTMLElement | null>(null);
const { width, height } = useElementSize(list);
const cardWidth = ref(0);
const cardHeight = ref(0);

function measure() {
  const el = list.value;
  const first = el?.querySelector<HTMLElement>(".browseitem");
  if (!el || !first) return;
  // The card itself: the sleeves are placed against its padding box, which is
  // what clientWidth measures, whatever the column count.
  cardWidth.value = first.clientWidth;
  cardHeight.value = first.clientHeight;
}

watch([width, height], measure);

function countLabel(total: number | null, noun: string) {
  if (total === null) return "";
  return `${total.toLocaleString()} ${noun}${total === 1 ? "" : "s"}`;
}

function tagFor(order: Order) {
  return order === "newest" ? "NEW IN" : "MOST PLAYED";
}

type Item = { image?: string; help_text?: string; has_artwork?: boolean };

async function fetchShown(type: "albums" | "artists", sortby: string, limit = FETCH_LIMIT) {
  const res = await getAllItems(type, { start: 0, limit, sortby, reverse: "1", artwork: true });
  if (res.status !== 200 || !res.data || !Array.isArray(res.data.items)) return null;
  // Capped here too: the endpoint may send more than was asked for.
  return { total: res.data.total, items: (res.data.items as Item[]).slice(0, limit) };
}

const unplayed = (it: Item) => /^0 play/.test(it.help_text || "");
const withArtwork = (it: Item) => !!it.image && it.has_artwork !== false;

type Page = NonNullable<Awaited<ReturnType<typeof fetchShown>>>;
type Shown = { page: Page | null; order: Order };

// The albums crate reads two lists, and asks for both AT ONCE: the newest
// NEWEST_ALBUMS albums, and the most-played ones, which stand in while fewer
// than NEW_IN_MIN of the newest have a cover. Sixteen newest were not
// enough: a batch of newly
// added albums without covers filled all sixteen places, and the crate stood
// empty beside its count of 898 albums. Paging further back and only then
// asking for the most-played took five requests one after the other, each
// queued behind Home's pictures on a server that answers one request at a
// time: with 90 coverless albums in front, the covers came 2.2 s after the
// page was opened, 1.3 s after the rows' first cover (measured at 150 ms
// latency, 2026-11-20). One round now, whichever list is used.
async function fetchAlbums(): Promise<Shown> {
  const [newest, top] = await Promise.all([
    fetchShown("albums", "created_date", NEWEST_ALBUMS),
    fetchShown("albums", "playcount"),
  ]);
  if (!newest || newest.items.filter(withArtwork).length >= NEW_IN_MIN) {
    return { page: newest, order: "newest" };
  }
  // Too few covers among the newest: a large import without artwork (176
  // episodes of a show, each its own album) leaves nothing, or a lone sleeve,
  // to show there. The most-played albums with a cover stand in, under MOST
  // PLAYED. Only if none of those has a cover either do the few new ones stay.
  const played = top ? top.items.filter((it) => !unplayed(it) && withArtwork(it)) : [];
  if (!played.length) return { page: newest, order: "newest" };
  return { page: { ...newest, items: played }, order: "most-played" };
}

// The most-played artists. The board says "MOST PLAYED", so an artist with no
// plays never stands in that row: a library with two played artists shows
// those two, not five arbitrary ones beside them. While no played artist has a
// picture of its own yet (nothing played, or only artists without an image),
// the row is the newest artists and says "NEW IN".
async function fetchArtists(): Promise<Shown> {
  const top = await fetchShown("artists", "playcount");
  if (!top) return { page: null, order: "most-played" };
  const played = top.items.filter((it) => !unplayed(it) && it.has_artwork !== false);
  if (played.length) return { page: { ...top, items: played }, order: "most-played" };
  return { page: await fetchShown("artists", "created_date"), order: "newest" };
}

// Both crates read the list endpoint the pages themselves use. The list answer
// says per item whether its picture is real artwork (`has_artwork`, asked for
// with `artwork`): the server decides it the way its image endpoint does
// (`lib/artwork.find_image`), so the row needs no request per picture. An item
// flagged `false` is dropped: a sleeve with no artwork of its own is not shown.
// An item WITHOUT the field (an older server) is kept, as before the flag
// existed. What is left is capped at SHOWN_MAX. If nothing with artwork
// remains, the crate has no covers and no board. A failed request leaves the
// card as name only: still a working link, nothing half-drawn.
async function load(entity: CrateEntity) {
  try {
    const { page, order } = await (entity === "album" ? fetchAlbums() : fetchArtists());
    if (!page) return;

    // The count and the pictures come from the same answer.
    data[entity].total = typeof page.total === "number" ? page.total : null;
    data[entity].order = order;

    const base = entity === "album" ? paths.images.thumb.medium : paths.images.artist.medium;
    data[entity].images = page.items
      .filter(withArtwork)
      .map((it) => base + it.image)
      .slice(0, SHOWN_MAX);
  } catch {
    // Decoration only: the card works without it.
  }
}

onMounted(() => {
  measure();
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
    // The board's height; the phone block changes it, and the fan's bottom
    // follows it (40 % of it stands behind the board).
    --board-h: 2.5rem;
    // A pressable card carries the hatch (#378). The name sticker reads the
    // same `--row-fill` as the card itself, so a fill swap carries over.
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius-sm);
    // The crates wear bacterio, not the sprinkle hatch (_candy.scss).
    @include mem-bacterio($on: surface);
    // Hard offset shadow: the tile sits above the grid ground (memphis).
    @include candy-raised(3px, 3px, $press: false);
    color: $candy-text;
    // Paint is a cut (styling.md: no colour in a transition — fill and text
    // flip in opposite directions and a fade greys both out mid-way). Only
    // motion stays soft: the shadow, and the texture sliding on hover (below).
    transition: background-position $motion-move $motion-curve, box-shadow $motion-shadow ease-out;

    // Die Kacheln kommen an wie die Kachelraster darunter (#143 / #162): zwei
    // Platten nebeneinander, die vorher als einziger Block der Startseite
    // sofort dastanden, während die Reihen darunter eintrafen.
    //
    // `mem-arrival` und nicht `btn-pop`, obwohl das hier Bedienelemente sind:
    // Der Pop ist für den 44-px-Satz gebaut. Diese Platte ist 160×70 und trägt
    // Schraffur und harten Schatten, also die Kachel-Anatomie — auf ihr liest
    // sich der Überschwinger als Wackeln, gemessen an denselben Kacheln in #162.
    @include mem-arrival;

    // The crate: the name sticker top left, a fan of sleeves across the whole
    // card underneath it, and the front board across the bottom.
    position: relative;
    overflow: hidden;
    height: 12rem;
    display: block;

    // The name and count, as a sticker plate that reads over the sleeves. No
    // hatch: a caption is not a control (styling.md).
    .label {
      position: relative;
      z-index: 3;
      display: inline-flex;
      flex-direction: column;
      align-items: flex-start;
      gap: $smaller;
      padding: 0.3rem 0.6rem;
      @include candy-box(var(--row-fill), $candy-radius-sm);
      box-shadow: mem-shadow(3px, 3px);
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

    // The fan of record sleeves: each one is positioned and tilted inline
    // (utils/crateFan.ts), spanning the whole card. The container's bottom sits
    // at 40 % of the board's height, so the lower part of every sleeve stands
    // behind the board. Later sleeves paint above earlier ones (DOM order).
    .covers {
      position: absolute;
      left: 0;
      right: 0;
      bottom: calc(var(--board-h) * 0.4);
      pointer-events: none;

      // Until the card is measured every sleeve sits at x=0: hidden, not piled
      // up in the corner for a frame.
      &.unmeasured {
        visibility: hidden;
      }

      img {
        position: absolute;
        object-fit: cover;
        border: $mem-picture-frame;
        border-radius: $candy-radius-sm;
        box-shadow: mem-shadow(3px, 3px);
        // No background of its own: a placeholder cover is a transparent tile
        // that Global/cover-placeholders.scss tints by its route.
      }

      // Artists stand as round portraits, not sleeves.
      &.round img {
        border-radius: 50%;
      }
    }

    // The board: the crate's front edge, full width, across the bottom. It
    // paints over the sleeves' lower part. Its fill is a darker shade of the
    // card's own fill, read through `--row-fill`, so the hover swap carries over.
    .board {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 2;
      height: var(--board-h);
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
  }

  // Colour coding: the card's FILL is its entity's pastel tint from the
  // shared palette — the same lavender/lime an album or artist wears in the
  // card rows. The shadow stays ink like every other plate; colour lives on
  // the surface, not the edge. Through `--row-fill`, so the name sticker takes
  // the same tint (one source). The tint is static, so the hatch switches to
  // the accent sprite (ink strokes in both themes) and the text to static ink.
  // Placed BEFORE the hover rule: same specificity, so the hover flip below
  // still wins by order.
  @each $name in album, artist {
    .browseitem.ent-#{$name} {
      --row-fill: #{mem-pastel(map-get($mem-entities, $name))};
      @include mem-bacterio($on: accent);
      color: $mem-ink;
    }
  }

  .browseitem:hover {
    --row-fill: var(--mem-hover);
    background-color: var(--mem-hover);
    // The hatch answers the fill (#422): paper strokes on the dark plate in
    // light mode, ink strokes on the paper plate in dark mode.
    background-image: var(--mem-bacterio-hover);
    // The text token travels with the fill (#422) — the fill is the contrast
    // surface now, so without this the tile is an unreadable solid plate.
    color: var(--mem-hover-text);
    // The sprinkles wake up, exactly like the card plates (#143,
    // Global/cards.scss): the sprite shifts by a few pixels as the surface
    // flips, so the strokes shuffle instead of simply swapping. Movement in
    // the TEXTURE, not on the crate.
    background-position: $mem-hatch-stir;
  }

  // Phones: the two crates side by side, each smaller. The card stays 9rem
  // tall, and the board and its label shrink with it; the fan follows the
  // card's size and the board's height through `--board-h`.
  @include mediumPhones {
    .browselist {
      gap: 0.75rem;
    }

    .browseitem {
      width: auto;
      height: 9rem;
      padding: 0.9rem 0.75rem;
      --board-h: 1.8rem;

      .name {
        font-size: 1.2rem;
      }

      .board {
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
