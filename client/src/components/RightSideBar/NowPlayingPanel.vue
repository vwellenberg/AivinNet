<template>
    <div class="np-panel">
        <!-- Context row + the way out. `PlayingFrom` owns the media cell and
             the divider between it and the label — see the rule about a divider
             belonging to the text side, not the media cell. -->
        <div class="np-head">
            <PlayingFrom class="np-from" />
        </div>

        <img
            v-if="track?.image"
            class="np-cover"
            :src="paths.images.thumb.large + track.image"
            :alt="track.title"
        />

        <div class="np-title-row">
            <div class="np-title-text">
                <RouterLink v-if="albumRoute" :to="albumRoute" class="np-title">{{ title }}</RouterLink>
                <div v-else class="np-title">{{ title }}</div>
                <ArtistName
                    v-if="track?.artists?.length"
                    class="np-artist"
                    :artists="track.artists"
                    :albumartists="track.albumartists"
                />
            </div>
            <HeartSvg :state="queue.currenttrackIsFav" btn_role="action" @handleFav="handleFav" />
        </div>

        <!-- About the artist. The card is left out entirely when the store has
             no entry for the hash, rather than rendering empty rows. -->
        <section v-if="summary" class="np-sec">
            <span class="np-sticker">About the artist</span>
            <RouterLink :to="artistRoute" class="np-artist-line">
                <img class="np-artist-img" :src="paths.images.artist.small + summary.image" :alt="summary.name" />
                <div class="np-artist-meta">
                    <div class="np-artist-name">{{ summary.name }}</div>
                    <div class="np-artist-counts">{{ artistCounts }}</div>
                </div>
            </RouterLink>
            <!-- Labels, not links: there is no genre route in this app. -->
            <div v-if="summary.genres?.length" class="np-chips">
                <span v-for="genre in summary.genres.slice(0, 3)" :key="genre.genrehash" class="np-chip">
                    {{ genre.name }}
                </span>
            </div>
            <div v-if="playedLine" class="np-plate">
                <span class="np-k">Played</span>
                <span class="np-v">{{ playedLine }}</span>
            </div>
        </section>

        <section v-if="infoRows.length" class="np-sec">
            <span class="np-sticker">Track info</span>
            <div v-for="row in infoRows" :key="row.k" class="np-plate">
                <span class="np-k">{{ row.k }}</span>
                <span class="np-v">{{ row.v }}</span>
            </div>
        </section>

        <section class="np-sec">
            <div class="np-sec-head">
                <span class="np-sticker">Up next</span>
                <!-- The route is `/nowplaying/:tab` — without the param
                     `router-link` throws "Missing required param" on render and
                     the link silently points nowhere. -->
                <RouterLink
                    :to="{ name: Routes.nowPlaying, params: { tab: 'home' } }"
                    class="np-queue-link"
                    >Queue &rarr;</RouterLink
                >
            </div>
            <!-- Same row as the Now Playing header renders, prop for prop.
                 Three of them carry meaning that is easy to get wrong alone:
                 `index` is the QUEUE position (a literal 1 would label every
                 row as the first and make `isCurrent` true whenever the first
                 track plays), `source` is required, and without `play-this`
                 the row looks pressable and does nothing. -->
            <SongItem
                v-if="queue.next?.trackhash"
                :track="queue.next"
                :index="queue.nextindex + 1"
                :is_first="true"
                :is_last="true"
                :source="dropSources.folder"
                @play-this="queue.playNext"
            />
            <div v-else class="np-empty">Nothing queued after this one.</div>
        </section>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { paths } from '@/config'
import { dropSources, favType } from '@/enums'
import { Routes } from '@/router'
import favoriteHandler from '@/helpers/favoriteHandler'
import { getArtistSummary } from '@/requests/artists'
import useQueue from '@/stores/queue'
import formatSeconds from '@/utils/useFormatSeconds'

import ArtistName from '@/components/shared/ArtistName.vue'
import HeartSvg from '@/components/shared/HeartSvg.vue'
import PlayingFrom from '@/components/NowPlaying/PlayingFrom.vue'
import SongItem from '@/components/shared/SongItem.vue'

const queue = useQueue()

const track = computed(() => queue.currenttrack)
const title = computed(() => track.value?.title || 'Nothing playing')

const albumRoute = computed(() =>
    track.value?.albumhash ? { name: Routes.album, params: { albumhash: track.value.albumhash } } : null
)

const artistRoute = computed(() => ({
    name: Routes.artist,
    params: { hash: summary.value?.artisthash || '' },
}))

const summary = ref<Awaited<ReturnType<typeof getArtistSummary>>>(null)

/**
 * The hash of the album artist, which is what the card is about. Falls back to
 * the track artist so a single with no album artist still shows something.
 */
const artistHash = computed(() => track.value?.albumartists?.[0]?.artisthash || track.value?.artists?.[0]?.artisthash)

watch(
    artistHash,
    async hash => {
        if (!hash) {
            summary.value = null
            return
        }

        const result = await getArtistSummary(hash)
        // The artist can change while this is in flight (skipping through the
        // queue). Dropping a stale answer keeps the card from showing the
        // previous artist under the current title.
        if (artistHash.value === hash) summary.value = result
    },
    { immediate: true }
)

const artistCounts = computed(() => {
    if (!summary.value) return ''
    const albums = summary.value.albumcount
    const tracks = summary.value.trackcount
    return `${albums} ${albums === 1 ? 'album' : 'albums'} · ${tracks} ${tracks === 1 ? 'track' : 'tracks'}`
})

const playedLine = computed(() => {
    const plays = summary.value?.playcount
    if (!plays) return ''
    return `${plays}×`
})

const infoRows = computed(() => {
    const t = track.value
    if (!t?.trackhash) return []

    // No year here: `Track` carries none (that lives on `Album`), and asking
    // the album route for it would trade a whole extra request for one number.
    const rows: { k: string; v: string }[] = []
    if (t.album) rows.push({ k: 'Album', v: t.album })
    if (t.genre) rows.push({ k: 'Genre', v: t.genre })
    if (t.bitrate) rows.push({ k: 'Format', v: `${t.filetype?.toUpperCase() || ''} ${t.bitrate} kbps`.trim() })
    if (t.duration) rows.push({ k: 'Length', v: formatSeconds(t.duration) as string })
    return rows
})

// Same handler the player bar uses, so the two hearts for one track cannot
// disagree — see BottomBar.vue.
function handleFav() {
    favoriteHandler(
        queue.currenttrackIsFav,
        favType.track,
        track.value?.trackhash || '',
        () => null,
        () => null
    )
}
</script>

<style lang="scss">
/**
 * A1 from the #424 mockups: a scrolled column of cards, built from this app's
 * own parts. Chrome takes `$mem-panel`, content takes `--mem-veil` — this panel
 * REPLACES the right sidebar, so it is chrome.
 */
.np-panel {
    height: 100%;
    min-width: 0;
    // Stated, not inherited: the wrapper still carries the pre-Memphis
    // `$candy-white`, so leaving this transparent measured as rgba(0,0,0,0) and
    // would have quietly followed whatever that token becomes next.
    background-color: $mem-panel;
    color: $mem-content-text;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    gap: $small;
    padding: $small;
    // The scroller clips at its padding box, so the radius belongs here or the
    // rows cut square corners into a rounded panel (#473).
    border-radius: $candy-radius - $candy-border-w;

    .np-head {
        display: flex;
        align-items: center;
        gap: $smaller;
        min-width: 0;
    }

    .np-from {
        flex: 1;
        min-width: 0;
    }

    .np-cover {
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
        display: block;
        border: $candy-border;
        border-radius: $candy-radius;
        @include candy-shadow(6px, 6px);
    }

    .np-title-row {
        display: flex;
        align-items: center;
        gap: $smaller;
        min-width: 0;

        .np-title-text {
            flex: 1;
            min-width: 0;
        }
    }

    .np-title {
        display: block;
        font-size: 1.15rem;
        font-weight: 700;
        letter-spacing: -0.01em;
        line-height: 1.2;
        color: $mem-content-text;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .np-artist {
        margin-top: 2px;
        font-size: 0.85rem;
        color: $mem-content-muted;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .np-sec {
        display: flex;
        flex-direction: column;
        gap: $smaller;
        min-width: 0;
    }

    .np-sec-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $smaller;
    }

    // Headings are stickers, and stickers stay SMOOTH — the hatch means "you
    // can press this", and a caption is not pressable.
    .np-sticker {
        @include mem-sticker;
        align-self: flex-start;
        background-color: $mem-blush;
        color: $mem-ink;
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
    }

    // Rows are plates, not hairlines (#479).
    .np-plate,
    .np-artist-line {
        @include candy-box($mem-panel, $candy-radius-sm);
        @include candy-shadow(3px, 3px);
        min-width: 0;
        color: $mem-content-text;
    }

    .np-plate {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: $small;
        padding: $smaller $small;
        font-size: 0.8rem;

        .np-k {
            font-weight: 700;
            flex: none;
        }

        .np-v {
            color: $mem-content-muted;
            text-align: right;
            min-width: 0;
            white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        }
    }

    .np-artist-line {
        display: flex;
        align-items: center;
        gap: $small;
        padding: $smaller $small;
        text-decoration: none;

        .np-artist-img {
            width: 3.25rem;
            height: 3.25rem;
            flex: none;
            object-fit: cover;
            object-position: top;
            border-radius: 10rem;
            border: $candy-border;
            @include candy-shadow(3px, 3px);
        }

        .np-artist-meta {
            min-width: 0;
        }

        .np-artist-name {
            font-size: 0.95rem;
            font-weight: 700;
            white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        }

        .np-artist-counts {
            margin-top: 2px;
            font-size: 0.78rem;
            color: $mem-content-muted;
        }
    }

    .np-chips {
        display: flex;
        flex-wrap: wrap;
        gap: $smaller;
    }

    // Small elements that are essentially their own label: full plate anatomy,
    // but no hatch — a texture would leave a 4px rim of noise.
    .np-chip {
        @include candy-box($mem-panel, $candy-radius-pill);
        @include candy-shadow(3px, 3px);
        padding: 2px $small;
        font-size: 0.7rem;
        font-weight: 700;
        color: $mem-content-text;
        text-decoration: none;
    }

    .np-queue-link {
        @include candy-box($mem-panel, $candy-radius-sm);
        @include candy-shadow(3px, 3px);
        padding: 3px $small;
        font-size: 0.65rem;
        font-weight: 700;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: $mem-content-text;
        text-decoration: none;
        flex: none;
    }

    .np-empty {
        font-size: 0.8rem;
        color: $mem-content-muted;
        padding: $smaller 0;
    }
}
</style>
