<template>
    <div
        class="songlist-item rounded-sm"
        :class="[
            { current: isCurrent() },
            { contexton: context_menu_showing },
            { 'with-plays': showPlaysColumn },
            { 'with-date': showDateColumn },
            { 'is-first': is_first },
            { 'is-last': is_last },
            bandClass,
            dragOverClass,
        ]"
        :style="{ '--band-fade': band_fade ?? 1 }"
        :draggable="droppable"
        @dragstart="onDragStart"
        @dragover.prevent="onDragOver"
        @dragleave="onDragLeave"
        @drop.prevent="onDrop"
        @dblclick="emitUpdate"
        @contextmenu.prevent="showMenu"
    >
        <TrackIndex
            v-if="!isSmall"
            :index="index"
            :is_current="isCurrent()"
            :is_current_playing="isCurrentPlaying()"
        />

        <TrackTitle
            :track="track"
            :is_current="isCurrent()"
            @play="emitUpdate"
        />

        <TrackAlbum
            :album="track.album || 'Unknown'"
            :albumhash="track.albumhash || ''"
            :hide_album="hide_album || false"
        />
        <TrackPlays v-if="showPlaysColumn" :playcount="track.playcount" />
        <TrackDateAdded v-if="showDateColumn" :timestamp="track.added_at" />
        <!--
            When the Plays column is shown (artist Top Tracks, wide layout) the
            play count is already visible, so suppress the duration's hover
            help_text ("N plays") to avoid showing the same number twice. On
            narrow layouts (no Plays column) help_text stays as the only way to
            surface the count.
        -->
        <TrackDuration
            :duration="track.duration || 0"
            :help_text="showPlaysColumn ? undefined : track.help_text"
            :is_fav="is_fav"
            :showFavIcon="!isFavoritesPage"
            :highlightFavoriteTracks="settings.highlightFavoriteTracks"
            @showMenu="showMenu"
            @toggleFav="addToFav(track.trackhash)"
        />
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { dropSources, favType } from '@/enums'
import { showTrackContextMenu as showContext } from '@/helpers/contextMenuHandler'
import favoriteHandler from '@/helpers/favoriteHandler'
import { Track } from '@/interfaces'
import { isMedium, isSmall } from '@/stores/content-width'
import useFavorites from '@/stores/favorites'
import useQueueStore from '@/stores/queue'
import { showDragStart, trackBandClass } from '@/utils/songItemMethods'

import TrackAlbum from './SongItem/TrackAlbum.vue'
import TrackDateAdded from './SongItem/TrackDateAdded.vue'
import TrackDuration from './SongItem/TrackDuration.vue'
import TrackIndex from './SongItem/TrackIndex.vue'
import TrackPlays from './SongItem/TrackPlays.vue'
import TrackTitle from './SongItem/TrackTitle.vue'
import useSettings from '@/stores/settings'

const settings = useSettings()
const context_menu_showing = ref(false)

const queue = useQueueStore()

const props = defineProps<{
    track: Track
    index: number | string
    hide_album?: boolean
    is_queue_track?: boolean
    // Opt in to reordering by drag. This alone decides it: the `draggable`
    // binding used to additionally require `source === playlist`, which quietly
    // made the flag a no-op everywhere else — the Now Playing queue set
    // `droppable` and still could not be dragged. Every call site that passes
    // the flag means it.
    droppable?: boolean
    // First/last row of a list section — closes the ink frame around the
    // translucent list plate (top/bottom edge + corner radii).
    is_first?: boolean
    is_last?: boolean
    source: dropSources
    show_plays?: boolean
    show_date_added?: boolean
    // Band strength for this row, 0.25–1 (see trackBandFade). Callers compute
    // it from the row's RENDERED position and the list total; omitted = 1
    // (lists with no usable total keep a uniform full-strength band).
    band_fade?: number
}>()

// Plays column is opt-in (artist "Popular"/Top Tracks) and hidden on narrow
// layouts. Gating both the class and the child on the same condition keeps the
// grid column count in sync with the rendered children.
const showPlaysColumn = computed(() => Boolean(props.show_plays) && !isSmall.value && !isMedium.value)

// "Date added" column is opt-in (playlist page only — mixes and the custom
// recently added/played playlists have no per-track added_at) and hidden on
// narrow layouts, following the same pattern as the Plays column.
const showDateColumn = computed(() => Boolean(props.show_date_added) && !isSmall.value && !isMedium.value)

// Colour guide band on the leading edge — see trackBandClass for why the cycle
// is computed rather than expressed as `:nth-child`, and mem-band-cycle in
// _candy.scss for the accents themselves.
const bandClass = computed(() => trackBandClass(props.index))

// Read, not copied. This used to be a `ref` seeded from the prop and re-seeded
// only when the row was RECYCLED onto another trackhash, so every flip that did
// not come from this row itself — the player bar, the Now Playing header, the
// right panel, another row for the same track — left the heart here showing the
// state the list was loaded with. The registry is the answer for the hash (see
// stores/favorites.ts); the prop is what the list arrived with.
const favorites = useFavorites()
const is_fav = computed(
    () => favorites.flag(favType.track, props.track.trackhash) ?? props.track.is_favorite ?? false
)

const emit = defineEmits<{
    (e: 'playThis'): void
    (e: 'trackDropped', source: dropSources, track: Track, newIndex: number, oldIndex: number): void
}>()

const dragOverTop = ref(false)
const dragOverBottom = ref(false)
const dragOverClass = computed(() => {
    if (dragOverTop.value) return 'drag-over-top'
    if (dragOverBottom.value) return 'drag-over-bottom'
    return ''
})

function onDragStart(e: DragEvent) {
    // The same guard as the `draggable` binding, and it has to be here too:
    // `draggable="false"` on the row does NOT stop a drag that starts on a
    // natively draggable child. The cover is marked (TrackTitle.vue), but the
    // artist links are `<a>` and draggable by nature as well.
    //
    // ⚠️ `preventDefault`, not just `return`. Returning suppresses the payload
    // and lets the native drag run: every playlist row it crosses paints its
    // insertion line, and the drop is then silently discarded — a dead
    // affordance rather than a mistake, but one nobody can tell from a working
    // one. Cancelling the event is what makes this guard cover whatever
    // draggable element lands in this row next.
    if (!props.droppable) {
        e.preventDefault()
        return
    }

    showDragStart(e, props.track, props.track.index, props.source)
}

function onDragOver(e: DragEvent) {
    // Read the rect ONCE (was twice): dragover fires continuously on every
    // recycled row the pointer crosses, and each getBoundingClientRect() forces
    // a synchronous layout — doubly expensive while the virtual scroller is
    // recycling rows during a drag-scroll. Only write the refs when the side
    // actually flips so we don't churn the class-patch cycle.
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const top = e.clientY < rect.top + rect.height / 2
    if (dragOverTop.value !== top) dragOverTop.value = top
    if (dragOverBottom.value !== !top) dragOverBottom.value = !top
}

function onDragLeave() {
    dragOverTop.value = false
    dragOverBottom.value = false
}

function onDrop(e: DragEvent) {
    dragOverTop.value = false
    dragOverBottom.value = false
    const data = e.dataTransfer?.getData('swing-track')
    if (!data) return
    const { track, source, oldIndex } = JSON.parse(data) as {
        track: Track
        source: dropSources
        oldIndex: number
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const top = e.clientY < rect.top + rect.height / 2
    const newIndex = top ? props.track.index : props.track.index + 1
    if (oldIndex === newIndex || oldIndex === newIndex - 1) return
    emit('trackDropped', source, track, newIndex, oldIndex)
}

function emitUpdate() {
    emit('playThis')
}

function showMenu(e: MouseEvent) {
    showContext(e, props.track, context_menu_showing)
}

function isCurrent() {
    if (props.is_queue_track) {
        return queue.currentindex == parseInt(props.index as string) - 1
    }

    return queue.currenttrackhash == props.track.trackhash
}

function isCurrentPlaying() {
    return isCurrent() && queue.playing
}

function addToFav(trackhash: string) {
    // No setter/remover: the handler records the flip for the hash, and this
    // row reads it back through `is_fav` like every other heart for that track.
    favoriteHandler(
        is_fav.value,
        favType.track,
        trackhash,
        () => null,
        () => null
    )
}

const route = useRoute()
const isFavoritesPage = route.path.startsWith('/favorites')
</script>

<style lang="scss">
// NOTE: CSS for responsiveness is at app-grid.scss
.songlist-item {
    display: grid;
    grid-template-columns: $songlist-index-col 2.5fr 1.5fr 7.5rem;
    align-items: center;
    justify-content: flex-start;
    gap: 1rem;
    font-weight: 500;
    line-height: 1.2;
    height: $song-item-height;
    user-select: none;
    // Clears the colour guide band on the leading edge (app-grid.scss paints
    // it into this inset); $small would have put the index circle on top of it.
    padding-left: $songlist-lead;
    position: relative;
    // Text sits directly on the page ground (grid area) -> theme-aware so it
    // turns white on the dark indigo ground. Filled row states (hover/current/
    // contexton) pin ink below (see the combined selector after this rule).
    color: $mem-content-text;
    // Reserved transparent border so the ink frame on hover/marked/playing rows
    // never shifts the content. (app-grid.scss zeroes the radius again for the
    // middle rows of the list plate — the frame there is continuous.)
    @include candy-row-base;
    // Zebra: the row's own band hue, faint, so the fill alternates warm/cool
    // with the band instead of adding a grey third layer. The filled states
    // (hover/current/contexton) each set their own background and win — hover
    // by pseudo-class, the other two by their extra class.
    @include mem-band-tint;

    // Plays column (issue #68): inserted between album and duration. Only set
    // on wide layouts (the .with-plays class is toggled off on isSmall/isMedium
    // together with the TrackPlays child), so it never clashes with the
    // responsive grids in app-grid.scss.
    //
    // The duration column is wider here (10rem vs the default 7.5rem): on
    // favorited rows the teal heart is shown inline in that column, and
    // at 7.5rem the check + duration + options overflowed left over the Plays
    // number (justify-content: end). 10rem keeps the check inside its own column
    // with enough headroom for the longest (HH:MM:SS) durations.
    &.with-plays {
        grid-template-columns: $songlist-index-col 2.5fr 1.5fr 5rem 10rem;
    }

    // "Date added" column (playlist page): inserted between album and duration,
    // same rationale as .with-plays above. The date column fits the longest
    // absolute date ("Sep 28, 2026"); the duration column keeps the 10rem
    // headroom for the inline favorite heart. Shared with the
    // AfterHeader caption row via $songlist-columns-with-date.
    &.with-date {
        grid-template-columns: $songlist-columns-with-date;
    }

    // Pointer devices only: on touch, `:hover` LATCHES after a tap (styling.md)
    // and stays until the next tap elsewhere. Ungated, these rules turned the
    // tapped row into desktop pointer chrome — most visibly on the playing row,
    // which lost its yellow fill to the old mobile half-measure in app-grid.scss
    // while this block's text flip stayed: white artist on the light ground,
    // dimmed cover (#457).
    @media (hover: hover) {
        &:hover {
            // The app-wide row hover (see candy-row-hover): the contrast
            // surface inside the ink frame. The playing/marked rows keep their
            // own fill — their state blocks sit later in this file and win the
            // tie.
            @include candy-row-hover;

            // (The duration/help-text crossfade used to stand here. It lives in
            // TrackDuration.vue now, next to the pair it swaps — see the note
            // there and the `opacity` warning in the mirrored block below.)

            .options-and-duration .heart-icon {
                visibility: visible;
            }
        }

        // The dim exists to reveal the play overlay, and the playing row has
        // none (TrackTitle renders it only when not current) — so its cover
        // stays undimmed.
        &:hover:not(.current) {
            .thumbnail .album-art {
                filter: brightness(0.55);
            }

            .thumb-play-overlay {
                opacity: 1 !important;
            }
        }
    }

    .index {
        overflow: unset !important;
    }
}

.songlist-item.current {
    // Fill, frame and the zigzag marker on the leading edge all come from the
    // one mixin the queue row uses too — see mem-now-playing-row in _candy.scss.
    @include mem-now-playing-row;
}

.songlist-item.contexton {
    // Blush, which hover vacated when it became the contrast surface (#418).
    // "This row owns the open context menu" still has to outrank "the pointer is
    // here" in PERSISTENCE — it survives the pointer leaving — but no longer in
    // loudness, so it takes the light accent while hover takes the dark one.
    //
    // A static accent, so the pinned ink text below reads in the dark theme too.
    @include candy-row-hover($mem-blush);
    background-color: $mem-blush !important;
    color: $mem-ink;
}

// Filled row states — the LIGHT ones only. The base row text is
// $mem-content-text (white on the dark ground), so ink gets pinned for the text
// and icons that now render over a light fill. The muted children carry explicit
// content tokens (album/duration) that the row `color` can't cascade into, so
// they get explicit ink-muted here; the opacity-based children
// (index/plays/date/artist) inherit the row ink automatically.
//
// ⚠️ `:hover` is deliberately NOT in this list any more (#418). Its fill is the
// contrast surface — dark in the light theme — and ink on it is invisible. The
// hover block below pins the mirrored colours instead. Anyone adding a state
// here checks first whether its fill is light or dark; the light theme shows
// only half the answer.
.songlist-item.current,
.songlist-item.contexton {
    color: $mem-ink;

    .song-album,
    .song-duration {
        color: $mem-text-muted-static;
    }

    .options-and-duration {
        .heart-icon.is_fav svg {
            // Teal "favorited" accent reads on the light row fills too.
            color: $mem-teal;
        }

        .options-icon svg {
            stroke: $mem-text-muted-static;
        }
    }

    // Unfavorited add/fav glyph declares its own adaptive colour (paper in
    // dark) — pin ink on the light row fills.
    //
    // `:not(.is-fav)` states what the comment already said. The favourited
    // glyph owns its fill (teal), and this selector outranks `.heart-button.is-fav`
    // by the row's own class — so without the exclusion the marker's disc would
    // go ink here and, since its tick is ink too, read as a solid blob.
    .heart-button:not(.is-fav) {
        color: $mem-ink;
    }
}

// The HOVERED row is the mirror image of the block above: its fill is the
// contrast surface, so everything on it flips to `--mem-hover-text` instead of
// ink. Same children, same reasons — the muted ones carry explicit tokens the
// row `color` cannot reach, so they are named again.
//
// Pointer devices only (see the gate on the base hover block): latched on
// touch, this block was what painted the tapped row's text white (#457).
//
// `:not(.current):not(.contexton)` because those two rows KEEP their light
// fill under the pointer (their fills win the background tie below), so the
// mirrored text on them would be white-on-yellow (1.66:1) and white-on-blush.
// The exclusion keeps this block paired with the fill it mirrors: it applies
// exactly where `candy-row-hover`'s contrast surface actually paints.
@media (hover: hover) {
    .songlist-item:hover:not(.current):not(.contexton) {
        color: var(--mem-hover-text);

        .song-album {
            color: var(--mem-hover-text);
            opacity: 0.75;
        }

        // ⚠️ The duration is muted by COLOUR, not by `opacity` — and that is
        // not a style preference. `opacity` on `.song-duration` is the channel
        // the duration/help-text pair crossfades on (TrackDuration.vue): one
        // twin fades out while the other fades in. A blanket `opacity: 0.75`
        // from here outranked both and left them stacked at 75 % on top of each
        // other — "04:02" and "1 play" in the same pill, unreadable, on every
        // row of a narrow-layout artist page (#541).
        //
        // `color-mix` mutes text AND the pill's `currentColor` ring by the same
        // amount, so this looks identical to what the opacity did — it just
        // leaves the crossfade its channel.
        .song-duration {
            color: color-mix(in srgb, var(--mem-hover-text) 75%, transparent);
        }

        .options-and-duration {
            .heart-icon.is_fav svg {
                // Teal keeps its meaning; it measures 3.9:1 on the ink surface.
                color: $mem-teal;
            }

            .options-icon svg {
                stroke: var(--mem-hover-text);
            }
        }

        .heart-button:not(.is-fav) {
            color: var(--mem-hover-text);
        }
    }
}

// The PLAYING row reads at full strength. It is the row the user is actually
// reading, and since it carries the sprinkle (mem-now-playing-row) the softer
// greys are what break down first. Album, date and duration stay muted
// everywhere else; here they are ink, and the two title lines gain one weight
// step each.
//
// The selectors are deliberately deeper than the defaults they beat: those live
// in the child components (TrackTitle / TrackAlbum / TrackDateAdded /
// TrackDuration), whose style blocks are emitted in import order — at equal
// specificity the outcome would be the bundler's to decide, not ours.
.songlist-item.current {
    > .tracktitle .song-title .title {
        font-weight: 700;
    }

    > .tracktitle .song-title > .isSmallArtists {
        opacity: 1;
        font-weight: 600;
    }

    > .song-album {
        color: $mem-ink;
        font-weight: 600;
    }

    > .song-date-added {
        opacity: 1;
        color: $mem-ink;
        font-weight: 600;
    }

    > .options-and-duration .song-duration {
        color: $mem-ink;
        font-weight: 600;
    }

    > .options-and-duration .options-icon svg {
        stroke: $mem-ink;
    }
}

.songlist-item.drag-over-top {
    border-top: 2px solid $mem-line;
}

.songlist-item.drag-over-bottom {
    border-bottom: 2px solid $mem-line;
}

.songlist-item[draggable="true"] {
    cursor: grab;
    &:active { cursor: grabbing; }
}
</style>
