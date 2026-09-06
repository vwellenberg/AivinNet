<template>
    <RouterLink
        :to="getRouterParams()"
        class="chartitem rounded-sm"
        :class="rankBadgeClass(rank)"
    >
        <ArrowSvg class="trend" :class="trend?.trend" />
        <div class="rank" :class="{ 'tilt-right': rank % 2 === 0 }">{{ rank }}</div>
        <template v-if="isPlaylist">
            <img v-if="asPlaylist.has_image" :src="playlistImageUrl" class="chartimage playlist" />
            <PlaylistImages
                v-else-if="asPlaylist.images && asPlaylist.images.length"
                :images="asPlaylist.images"
                size="small"
                class="chartimage playlist"
            />
            <div v-else class="chartimage playlist placeholder"><PlaylistSvg /></div>
        </template>
        <img v-else :src="getItemImage(item)" class="chartimage" :class="name" />
        <div class="iteminfo">
            <div class="title" :title="asArtist.name" v-if="isArtist || isPlaylist">
                {{ asArtist.name }} <MasterFlag v-if="trend?.is_new" :text="trend?.is_new ? 'New' : ''" :bitrate="1900"/>
            </div>
            <div class="title" :title="asTrack.title" v-if="isAlbumOrTrack">
                {{ asTrack.title }} <MasterFlag v-if="trend?.is_new" :text="trend?.is_new ? 'New' : ''" :bitrate="1900"/>
            </div>
            <div class="artist" v-if="isAlbumOrTrack">
                <ArtistName
                    :artists="asTrack.artists ? asTrack.artists : asTrack.albumartists"
                    :albumartists="asTrack.albumartists"
                />
            </div>
            <div class="artist" v-if="isArtist || isPlaylist">
                {{ asArtist.extra['playcount'] }} track plays
            </div>
            <div class="meter" v-if="meter_pct !== null">
                <i :style="{ width: meter_pct + '%' }"></i>
            </div>
        </div>
        <div class="helptext">
            {{ item.help_text }}
        </div>
    </RouterLink>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { paths } from '@/config'
import { Album, Artist, Playlist, Track } from '@/interfaces'
import ArrowSvg from '@/assets/icons/arrow.svg'
import PlaylistSvg from '@/assets/icons/playlist-1.svg'
import ArtistName from '../shared/ArtistName.vue'
import PlaylistImages from '../shared/PlaylistImages.vue'
import { Routes } from '@/router'
import MasterFlag from '../shared/MasterFlag.vue'
import { rankBadgeClass } from '@/utils/chartMeter'

type ChartName = 'artist' | 'album' | 'track' | 'playlist'
type ChartItem = Artist | Album | Track | Playlist

const props = defineProps<{
    item: ChartItem
    /** Absolute chart position (1-based, across pages) — drives badge + meter accents. */
    rank: number
    name: ChartName
    /** Play-duration share relative to the chart's #1, or null to hide the meter. */
    meter_pct: number | null
}>()

const isArtist = computed(() => props.name === 'artist')
const isAlbumOrTrack = computed(() => props.name === 'album' || props.name === 'track')
const isPlaylist = computed(() => props.name === 'playlist')

// The `name` prop (not a field on `item`) discriminates the union, but the
// template's v-if branches can't narrow `item` from it — cast once here.
const asArtist = computed(() => props.item as Artist)
const asTrack = computed(() => props.item as Track)
// Every chart payload may carry a trend; the Playlist interface just doesn't declare it.
const trend = computed(() => (props.item as Track).trend)

// Playlists may have no own image (image === "None"): fall back to the track
// covers (collage or single), like the sidebar does. See CLAUDE.md
// "Playlist image=None".
const asPlaylist = computed(() => props.item as Playlist)
const playlistImageUrl = computed(() => paths.images.playlist + asPlaylist.value.image)

function getItemImage(item: ChartItem) {
    switch (props.name) {
        case 'artist':
            return paths.images.artist.medium + item.image
        case 'album':
            return paths.images.thumb.medium + item.image
        case 'track':
            return paths.images.thumb.medium + item.image
    }
}

function getRouterParams() {
    switch (props.name) {
        case 'artist':
            return { name: Routes.artist, params: { hash: (props.item as Artist).artisthash } }
        case 'playlist':
            return { name: Routes.playlist, params: { pid: (props.item as Playlist).id } }
        default:
            return { name: Routes.album, params: { albumhash: (props.item as Album).albumhash } }
    }
}
</script>

<style lang="scss">
.chartitem {
    // A chart row is a pressable plate (it navigates), so it wears the shared
    // plate anatomy — ink frame, offset shadow, press-into-shadow — and is
    // registered in the rowHover census (rowHover.test.ts, PLATES).
    //
    // WITHOUT the hatch (#468). The texture marks a control among non-controls;
    // in a list where every row is a control it marks nothing, and at ~1900px
    // wide it ran ~50 tiles across, straight through the title and subtitle.
    // The screen's CHROME — the tab segments, the pager buttons — keeps it, and
    // that contrast is now the thing the texture says. See mem-row-plate.
    @include mem-row-plate($candy-radius-sm, $hatch: false);
    // Charts keep their translucent ground plate: the grid + doodles shimmer
    // through between the rows, which is what sets this screen apart from the
    // song list's cassette inlay. `--row-fill` is the plate's own indirection.
    --row-fill: var(--mem-veil);

    padding: $small 2rem;
    padding-left: 1.25rem;

    display: grid;
    // Last column `auto`, not `max-content`: under pressure (phones) the
    // duration may wrap instead of running out of the row's frame.
    grid-template-columns: 1.5rem 2.9rem max-content 1fr auto;
    gap: 1.5rem;
    align-items: center;

    margin-bottom: $medium;

    // A phone has no room for five columns side by side. Measured at 320px:
    // the track is 258px, and the fixed part alone — 24 + 46 + 46 plus four
    // 24px gaps — is 212, which left the title and the duration ~46px to
    // share. They did not share it; they overlapped.
    //
    // So the duration drops UNDER the info block rather than out of the row.
    // Hiding it would have been the easy half of this fix and the wrong one:
    // "78 hrs, 16 mins" is the number the leaderboard is sorted by.
    @include smallerPhones {
        grid-template-columns: 1.5rem 2.9rem max-content 1fr;
        gap: $small $medium;

        .helptext {
            grid-column: 4;
            grid-row: 2;
        }
    }

    &:hover {
        // `$hatch: false` mirrors the base plate: a row that grew a texture
        // under the pointer would be worse than one that always had it.
        @include mem-row-plate-hover($hatch: false);

        // Children that pin their own (muted/theme) colours flip with the
        // plate — the fill is dark in light mode, so everything on it swaps.
        .artist,
        .helptext,
        .trend.rising,
        .trend.falling {
            color: var(--mem-hover-text);
        }

        .chartimage,
        .meter {
            border-color: var(--mem-hover-text);
        }
    }

    // Rank badge: a crooked sticker. Top 3 wear accent fills (yellow /
    // lavender / pink); it is a LABEL, so no hatch — the texture means "you
    // can press this" and the pressable thing here is the row (styling.md).
    .rank {
        width: 2.6rem;
        height: 2.6rem;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.2rem;
        font-weight: 900;
        background-color: $mem-panel;
        color: $mem-content-text;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        box-shadow: 2px 2px 0 var(--mem-shadow);
        transform: rotate(-4deg);

        &.tilt-right {
            transform: rotate(3deg);
        }
    }

    &.r1 .rank { background-color: $mem-yellow; color: $mem-ink; }
    &.r2 .rank { background-color: $mem-lavender; color: $mem-ink; }
    &.r3 .rank { background-color: $mem-pink; color: $mem-ink; }

    // Play-duration meter: the leaderboard made visible. Lavender by default
    // (teal means play, yellow means playing); the top 3 take their badge's
    // colour. The ink frame carries the contrast, the fill the identity.
    .meter {
        margin-top: 0.45rem;
        height: 0.65rem;
        max-width: 26rem;
        border: 2px solid $mem-line;
        border-radius: $candy-radius-pill;
        overflow: hidden;

        i {
            display: block;
            height: 100%;
            background-color: $mem-lavender;
        }
    }

    &.r1 .meter i { background-color: $mem-yellow; }
    &.r2 .meter i { background-color: $mem-lavender; }
    &.r3 .meter i { background-color: $mem-pink; }

    .chartimage.artist {
        border-radius: 50%;
    }

    .chartimage.playlist.placeholder {
        width: 48px;
        display: grid;
        place-items: center;
        background-color: $candy-pink-soft;

        svg {
            width: 1.5rem;
            height: 1.5rem;
        }
    }

    .iteminfo {
        // The `1fr` column this sits in has an automatic minimum of MIN-CONTENT
        // like every other grid item, so without this the longest WORD in a
        // title sets the row's width — and since #558 the group can no longer
        // stretch to absorb it, it would push the page sideways instead. The
        // measured 257px min-content is one library's titles, not a property
        // of the layout.
        min-width: 0;

        .title {
            font-size: 1rem;
            font-weight: bold;
            color: inherit;
            // `anywhere`, not `break-word`: only this one lowers the element's
            // MIN-CONTENT, which is the number the grid track reads. And not
            // an ellipsis — a title that wraps to two lines is readable on a
            // 320px phone; the same title clamped to one line in a column that
            // narrow renders as nothing at all (measured).
            overflow-wrap: anywhere;
        }

        .artist {
            font-size: 0.85rem;
            color: $mem-content-muted;
            margin-top: 0.2rem;
        }
    }

    .chartimage {
        // Glued-on cover: full ink frame, like the song list's inlay covers.
        border: 2px solid $mem-line;
        border-radius: 0.25rem;
        height: 48px;
        // Square crop: playlist banner thumbs are 250px HIGH with free
        // aspect ratio — a landscape image rendered at width:auto blows up
        // the chart row. Album covers are square anyway and unaffected.
        width: 48px;
        object-fit: cover;
    }
    .trend {
        height: 1.25rem;
    }

    .trend.rising {
        transform: rotate(90deg);
        // Trend arrow over the row plate -> theme-aware.
        color: $mem-content-text;
    }

    .trend.falling {
        transform: rotate(-90deg);
        color: $mem-content-text;
    }

    .is_new {
        color: $candy-text;
    }

    .helptext {
        font-size: 0.75rem;
        color: $mem-content-muted;
        text-align: right;
        text-transform: uppercase;
        font-weight: bold;
    }

    // Narrow phones: the row keeps all five cells, so every fixed width
    // shrinks a step — measured against 360/390px, where the duration used
    // to run out of the frame. Sits at the end of the selector on purpose
    // (styling.md: breakpoint blocks last, or equal-specificity rules above
    // win by order).
    @include allPhones {
        padding: $small 0.9rem $small 0.75rem;
        grid-template-columns: 1.25rem 2.4rem max-content 1fr auto;
        gap: 0.75rem;

        .rank {
            width: 2.2rem;
            height: 2.2rem;
            font-size: 1.05rem;
        }

        .helptext {
            font-size: 0.7rem;
        }
    }
}
</style>
