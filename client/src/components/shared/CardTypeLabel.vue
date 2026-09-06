<template>
    <!-- The type label of a cover tile: a small plate that says WHAT the tile
         is, sitting above the artwork. It is the Now-Playing source plate
         (`NowPlaying/PlayingFrom.vue`) one size down — glyph cell, dividing
         rule, uppercase type — so the same anatomy reads across the player,
         the tiles and the detail headers.

         `pointer-events: none`: the whole tile is one link, and a label that
         swallowed clicks would leave a dead strip at its top edge. -->
    <div class="card-type-label" :class="`is-${type}`">
        <div class="glyph">
            <component :is="GLYPHS[type]" />
        </div>
        <div class="label">{{ LABELS[type] }}</div>
    </div>
</template>

<script setup lang="ts">
import AlbumSvg from '@/assets/icons/album.svg'
import ArtistSvg from '@/assets/icons/artist.svg'
import BookmarkSvg from '@/assets/icons/bookmark.svg'
import FolderSvg from '@/assets/icons/folder.svg'
import NoteSvg from '@/assets/icons/note.svg'
import PlaylistSvg from '@/assets/icons/playlist.svg'
import { CARD_TYPE_LABELS, CardType } from '@/utils/cardTypes'

const GLYPHS = {
    album: AlbumSvg,
    artist: ArtistSvg,
    // The favourites section is a bookmark, never a heart.
    favorite: BookmarkSvg,
    folder: FolderSvg,
    playlist: PlaylistSvg,
    track: NoteSvg,
}

// The words themselves live next to `isTypeEcho()` in utils/cardTypes: the
// tiles compare their help text against them, and two copies would drift.
const LABELS = CARD_TYPE_LABELS

defineProps<{
    type: CardType
}>()
</script>

<style lang="scss">
.card-type-label {
    // Only as wide as the word — the plate is a tag, not a bar. `width` on the
    // grid item itself, because the tile's rows are full-width tracks.
    width: fit-content;
    max-width: 100%;
    display: flex;
    align-items: stretch;
    pointer-events: none;

    background-color: $mem-panel;
    // NO hatch (#476). This is a LABEL — it even sets `pointer-events: none`,
    // so it could never be pressed — and the word ("Album", "Artist") fills it.
    // Stickers in this design are smooth for exactly that reason; the texture
    // behind four letters was noise on both counts.
    border: $candy-border;
    border-radius: $candy-radius-sm;
    box-shadow: 3px 3px 0 var(--mem-shadow);
    overflow: hidden;
    // Motion only — the paint is a cut (styling.md), together with the plate.
    transition: box-shadow 0.12s ease-out;

    // The glyph cell carries the ENTITY colour (see $mem-entities in
    // _candy.scss): the smallest possible dose — one small field that already
    // had a fill of its own — and enough for the eye to sort a mixed row by
    // type. No text changes its background, so no contrast pairing changes.
    @each $name, $colour in $mem-entities {
        &.is-#{$name} .glyph {
            @include mem-entity-tint($name);
        }
    }

    .glyph {
        flex-shrink: 0;
        width: 1.9rem;
        display: flex;
        align-items: center;
        justify-content: center;
        // Fallback for a type without an entity colour. The tint above is
        // STATIC (mixed toward paper), so the glyph on it is static ink — same
        // rule as the sidebar's tinted row plates.
        background-color: $candy-pink-soft;
        color: $candy-text;

        svg {
            width: 1.15rem;
            height: 1.15rem;
        }
    }

    // The rule belongs to the TEXT side: the glyph cell has the plate's rounded
    // corner, and a `border-right` there would be drawn along that radius.
    .label {
        border-left: $candy-border;
        padding: 0.25rem 0.6rem;
        min-width: 0;
        display: flex;
        align-items: center;

        text-transform: uppercase;
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        font-weight: 700;
        line-height: 1.2;
        color: $candy-text-muted;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}
</style>
