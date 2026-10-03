<template>
  <div class="homebrowse">
    <div class="btitle"><b>Browse Library</b></div>
    <div class="browselist">
      <RouterLink
        v-for="i in browselist"
        :key="i.title"
        class="browseitem rounded-sm"
        :to="{ name: i.route || '', params: i.params }"
        @click="i.action && i.action()"
        :class="[`ent-${i.entity}`, { favorite: i.favorite }]"
      >
        <div class="icon" v-html="i.icon"></div>
        <div class="label">
          {{ i.title }}
        </div>
      </RouterLink>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { RouteParamsRaw } from "vue-router";

import {
  AlbumIcon,
  ArtistIcon,
  BookmarkIcon,
  PlaylistIcon,
} from "@/icons";
import { Routes } from "@/router";

// The keys of `$mem-entities` (_candy.scss) a tile can be coloured by.
type BrowseEntity = "album" | "artist" | "playlist" | "track";

// A library shortcut card. `icon` is a raw svg string rendered via `v-html`.
// `entity` colours the tile's fill (what you will find behind it);
// `favorite` adds the gold ring (that it is your favourites only).
interface BrowseItem {
  title: string;
  route: string;
  icon: string;
  entity: BrowseEntity;
  favorite?: boolean;
  params?: RouteParamsRaw;
  action?: () => void;
}

// INFO: Library shortcuts on the home page.
const browselist: BrowseItem[] = [
  {
    title: "Albums",
    entity: "album",
    route: Routes.AlbumList,
    icon: AlbumIcon,
  },
  {
    title: "Artists",
    entity: "artist",
    route: Routes.ArtistList,
    icon: ArtistIcon,
  },
  {
    title: "Playlists",
    entity: "playlist",
    route: Routes.playlists,
    icon: PlaylistIcon,
  },
  {
    title: "Fav. tracks",
    entity: "track",
    route: Routes.favoriteTracks,
    icon: BookmarkIcon,
    favorite: true,
  },
  {
    title: "Fav. artists",
    entity: "artist",
    route: Routes.favoriteArtists,
    icon: ArtistIcon,
    favorite: true,
  },
  {
    title: "Fav. albums",
    entity: "album",
    route: Routes.favoriteAlbums,
    icon: AlbumIcon,
    favorite: true,
  },
];
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

  .browselist {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    margin-top: $small;
  }

  .browseitem {
    // Fixed width: these tiles are a free-wrapping flex row with no alignment
    // contract to the card grid. They used to borrow the MEASURED card width
    // from content-width.ts, which made them jump between ~137px (unmeasured
    // default) and ~200px depending on which page had measured last.
    // -8px, not -24px: the two hatch cover patches take 16px out of the label
    // line, and "Fav. albums" needed exactly the old width — measured 74px one
    // line at 168px, 92px wrapped when the covers arrived.
    width: calc(#{$cardwidth} - 8px);
    font-weight: 500;
    padding: 1.25rem 1rem;
    // A pressable card carries the hatch (#378). Content sits on smooth cover
    // patches that read the same `--row-fill` as the tile itself, so a fill
    // swap can never split surface and cover — the mem-row-plate pattern.
    --row-fill: #{$mem-panel};
    @include candy-box(var(--row-fill), $candy-radius-sm);
    @include mem-hatch(38px, $on: surface);
    // Hard offset shadow: the tile sits above the grid ground (memphis).
    @include candy-raised(3px, 3px, $press: false);
    color: $candy-text;
    transition: background-color $motion-move ease-out, color $motion-move ease-out, box-shadow $motion-shadow ease-out;

    // Die Kacheln kommen an wie die Kachelraster darunter (#143 / #162): sechs
    // Platten nebeneinander, die vorher als einziger Block der Startseite
    // sofort dastanden, während die Reihen darunter eintrafen.
    //
    // `mem-arrival` und nicht `btn-pop`, obwohl das hier Bedienelemente sind:
    // Der Pop ist für den 44-px-Satz gebaut. Diese Platte ist 160×70 und trägt
    // Schraffur und harten Schatten, also die Kachel-Anatomie — auf ihr liest
    // sich der Überschwinger als Wackeln, gemessen an denselben Kacheln in #162.
    @include mem-arrival;

    display: grid;
    grid-template-columns: max-content 1fr;
    place-items: center;
    gap: $small;

    .icon,
    .label {
      @include mem-hatch-clear(4px);
    }

    .label {
      width: 100%;
    }

    .icon {
      height: calc(1.75rem + 4px); // glyph + the cover's 2px vertical buffer
    }

    svg {
      height: 1.75rem;
      // No colour of its own: it inherits the tile's, so the hover flip below
      // reaches the glyph too. A pinned `$candy-text` here sat ink-on-ink the
      // moment the hover fill became the contrast surface (#422).
    }
  }

  // Favourites: a gold ring INSIDE the ink frame. Inside, not instead of
  // the frame: gold on a pastel fill is too pale to be the tile's edge, the
  // ink frame stays the contrast line. Inset 2px within the 3px frame, hence
  // radius - 5px. A pseudo-element rather than `outline`, because outline is
  // the keyboard focus ring (focus-ring) and must stay free for it.
  .browseitem.favorite {
    position: relative;

    &::after {
      content: "";
      position: absolute;
      inset: 2px;
      border: $mem-ring-w solid $mem-gold;
      border-radius: max(0px, calc(#{$candy-radius-sm} - 5px));
      pointer-events: none;
    }
  }

  .settings svg {
    color: $candy-text;
  }

  .reload svg {
    // INFO: The icons is a bit larger than the others
    width: 1.25rem;
  }

  // Colour coding: the tile's FILL is its entity's pastel tint from the
  // shared palette — the same lavender/coral/pink/yellow an album, artist,
  // playlist or track wears in the sidebar and the card rows. The shadow stays
  // ink like every other plate; colour lives on the surface, not the edge.
  // Through `--row-fill`, so the hatch covers under icon and label take the
  // same tint (one source, see mem-hatch-clear). The tint is static, so the
  // hatch switches to the accent sprite (ink strokes in both themes) and the
  // text to static ink. Placed BEFORE the hover rule: same specificity, so the
  // hover flip below still wins by order.
  @each $name in album, artist, playlist, track {
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

  // Phones: two tiles side by side instead of one fixed-width tile per row.
  // The fixed width has no room at 390px (168px + 24px gap wraps to a single
  // column), so the grid owns the width and the tiles give theirs up.
  @include mediumPhones {
    .browselist {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.75rem;
    }

    .browseitem {
      width: auto;
      padding: 0.9rem 0.75rem;
      font-size: 0.95rem;
    }
  }
}
</style>
