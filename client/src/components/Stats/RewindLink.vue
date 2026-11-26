<template>
    <!-- The way to Rewind (#527), kept for good at the foot of the stats page
         (#572): the latest finished year, seen or not. What announces a new
         Rewind is Home's January card; this is where it stays afterwards.
         A section like the others above it, with its own sticker heading.

         The door is a cassette (2026-11-25, chosen from four ideas): the year
         as a tape that has played to its end. The label carries the year, the
         tape length in minutes (a C-90 holds ninety of them) and the year's
         notes; under the pointer the label straightens and the tape rewinds,
         both reels turning back while the tape winds from the full reel onto
         the empty one. Once there are many years, one tape per year on a shelf. -->
    <section v-if="year" class="rewind-section">
        <h3 class="section-title">Rewind</h3>
        <RouterLink
            class="rewind-tape"
            :to="{ name: Routes.Rewind, params: { year } }"
            :aria-label="`Your ${year} Rewind`"
            :aria-describedby="teaser ? `${uid}-length ${uid}-notes` : `${uid}-notes`"
        >
            <span class="tape-screw is-top-left" aria-hidden="true"></span>
            <span class="tape-screw is-top-right" aria-hidden="true"></span>
            <span class="tape-screw is-bottom-left" aria-hidden="true"></span>
            <span class="tape-screw is-bottom-right" aria-hidden="true"></span>

            <span class="tape-label">
                <span class="tape-band" aria-hidden="true">
                    <span class="tape-side">A</span>
                    <span class="tape-brand">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path d="M11.5 5.5v13L2.5 12zM21.5 5.5v13l-9-6.5z" fill="currentColor" />
                        </svg>
                        <span class="tape-brand-word">Rewind</span>
                    </span>
                    <span v-if="teaser" :id="`${uid}-length`" class="tape-length">C-{{ tapeMinutes }}<small>min</small></span>
                </span>

                <span class="tape-year">
                    {{ year }}
                    <small>Your year in music</small>
                </span>

                <!-- The window into the shell: two tape packs on their reels. The
                     year is over, so the tape sits at its end, wound onto the
                     right-hand reel. -->
                <span class="tape-window" aria-hidden="true">
                    <span class="tape-pack is-left"></span>
                    <span class="tape-pack is-right"></span>
                    <span class="tape-reel is-left"></span>
                    <span class="tape-reel is-right"></span>
                </span>

                <!-- The notes written on the label's lines. The link's name is
                     short ("Your 2025 Rewind"); the notes and the length are its
                     description, so a screen reader hears them too. -->
                <span :id="`${uid}-notes`" class="tape-notes">
                    <template v-if="teaser">
                        <span class="tape-line">
                            <b>{{ teaser.plays.toLocaleString('en') }}</b> plays on <b>{{ teaser.days }}</b> days
                        </span>
                        <span v-if="teaser.top_artists[0]" class="tape-line">
                            <span class="tape-key">Top artist</span> <b>{{ teaser.top_artists[0].name }}</b>
                        </span>
                        <span v-if="teaser.top_tracks[0]" class="tape-line">
                            <span class="tape-key">Top track</span> <b>{{ trackLine(teaser.top_tracks[0]) }}</b>
                        </span>
                    </template>
                    <span v-else class="tape-line is-blurb">Played back: your top tracks, artists and biggest day.</span>
                </span>
            </span>

            <!-- The bridge at the foot of the shell, where the tape runs past
                 the head: guide holes, capstan holes, the fifth screw. -->
            <span class="tape-bridge" aria-hidden="true">
                <svg class="tape-bridge-edge" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <path d="M0 100 L14 0 L86 0 L100 100" />
                </svg>
                <span class="tape-hole is-round"></span>
                <span class="tape-hole is-square"></span>
                <span class="tape-screw"></span>
                <span class="tape-hole is-square"></span>
                <span class="tape-hole is-round"></span>
            </span>
        </RouterLink>
    </section>
</template>

<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'

import { getRewind } from '@/requests/stats'
import { Routes } from '@/router'
import { RewindPayload, trackLine } from '@/utils/rewind'

const props = defineProps<{ year: number | null | undefined }>()
const uid = useId()

// The taste of the year comes from the Rewind itself (the server keeps the
// latest one built). Without it the tape still opens, with a line of text.
const teaser = ref<RewindPayload | null>(null)

// A tape is named by its length in minutes, with no separators: C-90, C-12014.
// Rounded like the Rewind's own big number (`minutes()` in utils/rewind).
const tapeMinutes = computed(() => (teaser.value ? Math.round(teaser.value.seconds / 60) : 0))

watch(
    () => props.year,
    async year => {
        teaser.value = null
        if (!year) return
        try {
            const res = await getRewind(year)
            if (res.status === 200 && res.data?.year === year && res.data.plays) teaser.value = res.data
        } catch {
            // The tape without its notes.
        }
    },
    { immediate: true }
)
</script>

<style lang="scss" scoped>
.rewind-section {
    // Under the calendar and the records, as far from them as they are from each other.
    margin-top: 2rem;
    // The tape answers the width it has, not the window's (styling.md: beside
    // the sidebar the window width lies).
    container: rewind-tape / inline-size;
}

.section-title {
    @include mem-sticker;
    margin: 0 0 1rem 0;
    font-size: 1.15rem;
    font-weight: 700;
}

// Rewinding: the tape winds back onto the left reel while both reels turn
// backwards, and the label straightens like a stuck-on cover does under the
// pointer.
@mixin tape-rewinding {
    --pack-left: 1;
    --pack-right: 0.62;

    .tape-label {
        transform: none;
    }

    // Three turns at the spin of the app's spinners, exactly as long as the
    // packs take to change over; then the tape is back at its start and the
    // reels stand still. A name of its own, not `spin`: the reduced-motion
    // policy keeps every `spin` turning, and this is no spinner.
    .tape-reel {
        animation: tape-rewind $motion-spin linear 3;
    }
}

@keyframes tape-rewind {
    to {
        transform: rotate(-360deg);
    }
}

// The pack sizes are numbers the browser can interpolate, so the packs grow by
// their width (and keep a 2 px ring) instead of being scaled (which thinned the
// ring to under a pixel on the small pack). Without @property the swap is
// simply instant.
@property --pack-left {
    syntax: '<number>';
    inherits: true;
    initial-value: 0.62;
}

@property --pack-right {
    syntax: '<number>';
    inherits: true;
    initial-value: 1;
}

// ---------------------------------------------------------------------------
// THE SHELL — the plate, and the link. A pressable plate (styling.md): the
// hatch in the accent sprite on the static pastel, the offset shadow, and under
// the pointer the flip to the contrast surface with the sprinkles stirring.
// The label is a sticker on it and does not flip; what sits on the shell
// itself (the bridge's outline and holes) draws in `currentColor`, so it flips
// with the shell.
// ---------------------------------------------------------------------------
.rewind-tape {
    --row-fill: var(--look-tile-fill, #{mem-pastel($mem-lavender)});
    // Where the tape sits: played to its end, nearly all of it on the right
    // reel. The empty pack stays clearly wider than its hub: at 0.42 it was a
    // brown sliver between two ink rings, a hairline in all but name.
    --pack-left: 0.62;
    --pack-right: 1;
    position: relative;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    justify-items: center;
    // A tape, not a banner: on a wide page it lies at the left, the size of
    // an object, starting at the edge the heading starts at.
    max-width: 50rem;
    padding: 1.4rem 1.6rem 0;
    background-color: var(--row-fill);
    @include mem-hatch($on: accent);
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-raised($press: false);
    // After the mixin: its transition would drop the stir (the colours cut).
    // The packs change over in exactly the time the reels take for their turns.
    transition:
        box-shadow $motion-shadow ease-out $motion-lag,
        background-position $motion-move $motion-curve,
        --pack-left calc(#{$motion-spin} * 3) ease-in-out,
        --pack-right calc(#{$motion-spin} * 3) ease-in-out;
    color: var(--look-tile-text, #{$mem-ink});
    text-decoration: none;
    @include focus-ring;

    @media (hover: hover) {
        &:hover {
            --row-fill: var(--mem-hover);
            background-image: var(--mem-hatch-hover);
            background-position: $mem-hatch-stir;
            color: var(--mem-hover-text);
            @include tape-rewinding;
        }
    }

    // The keyboard gets the rewind too, without the pointer's flip.
    &:focus-visible {
        @include tape-rewinding;
    }

    @container rewind-tape (max-width: 36rem) {
        padding: 1rem 1rem 0;
    }
}

// Five screws hold a cassette together: one in each corner, one in the bridge.
// Static paper heads with an ink ring, so they read on the pastel and on
// either contrast surface.
.tape-screw {
    display: block;
    flex-shrink: 0;
    width: 1rem;
    height: 1rem;
    border: $mem-ring-w solid $mem-ink;
    border-radius: 50%;
    background-color: $mem-paper;
    // The slot is as heavy as a plate's edge (3 px of the 12 px head).
    background-image: linear-gradient(var(--slot, 35deg), transparent 37.5%, #{$mem-ink} 37.5% 62.5%, transparent 62.5%);

    &.is-top-left,
    &.is-top-right,
    &.is-bottom-left,
    &.is-bottom-right {
        position: absolute;
    }

    &.is-top-left {
        top: 0.25rem;
        left: 0.25rem;
    }

    &.is-top-right {
        --slot: -20deg;
        top: 0.25rem;
        right: 0.25rem;
    }

    &.is-bottom-left {
        --slot: 80deg;
        bottom: 0.25rem;
        left: 0.25rem;
    }

    &.is-bottom-right {
        --slot: 10deg;
        right: 0.25rem;
        bottom: 0.25rem;
    }

    @container rewind-tape (max-width: 36rem) {
        &.is-top-left,
        &.is-top-right {
            top: 0.1rem;
        }

        &.is-top-left,
        &.is-bottom-left {
            left: 0.1rem;
        }

        &.is-top-right,
        &.is-bottom-right {
            right: 0.1rem;
        }

        &.is-bottom-left,
        &.is-bottom-right {
            bottom: 0.1rem;
        }
    }
}

// ---------------------------------------------------------------------------
// THE LABEL — paper stuck on the shell, a touch crooked. The year on the left,
// the window through the middle, the notes on ruled lines on the right; across
// the top the stripes every tape label of the eighties had.
// ---------------------------------------------------------------------------
.tape-label {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    grid-template-areas:
        'band band band'
        'year window notes';
    align-items: center;
    column-gap: 1.25rem;
    row-gap: 0.75rem;
    width: 100%;
    padding-bottom: 0.9rem;
    // Paper in the light mode, dusk paper in the dark one (the pastels go down
    // with the mode); ink on it in both. Boring keeps its tile.
    background-color: var(--look-tile-fill, #{mem-pastel($mem-paper, 82%)});
    border: $candy-border;
    border-radius: $candy-radius-sm;
    color: var(--look-tile-text, #{$mem-ink});
    overflow: hidden;
    // Boring stands it straight (`--shape-tilt: 0`), like the rank stickers.
    transform: rotate(calc(-0.8deg * var(--shape-tilt, 1)));
    transition: transform $motion-move $motion-curve;

    @container rewind-tape (max-width: 36rem) {
        grid-template-columns: minmax(0, 1fr) auto;
        grid-template-areas:
            'band band'
            'year window'
            'notes notes';
        column-gap: 0.75rem;
    }

    // The smallest phones: the window gets a row of its own.
    @container rewind-tape (max-width: 21rem) {
        grid-template-columns: minmax(0, 1fr);
        grid-template-areas:
            'band'
            'year'
            'window'
            'notes';
    }
}

// Three stripes across the top, edge to edge (thin paper gaps between them
// read as hairlines), and on them three stickers printed with the plate's
// 3 px edge: the side, the name, the length. Boring has no accent stripes
// (its label fill is transparent), so the band is plain there.
.tape-band {
    grid-area: band;
    display: flex;
    align-items: center;
    gap: 0.6rem;
    min-width: 0;
    padding: 0.45rem 0.75rem;
    border-bottom: $candy-border-w solid $mem-ink;
    background-image: linear-gradient(
        to bottom,
        var(--look-stat-label-fill, #{$mem-teal}) 0 33.4%,
        var(--look-stat-label-fill, #{$mem-yellow}) 33.4% 66.7%,
        var(--look-stat-label-fill, #{$mem-coral}) 66.7% 100%
    );
}

.tape-side {
    display: grid;
    flex-shrink: 0;
    place-items: center;
    width: 1.9rem;
    height: 1.9rem;
    border: $candy-border-w solid $mem-ink;
    border-radius: $candy-radius-xs;
    background-color: $mem-ink;
    color: $mem-paper;
    font-size: 1rem;
    font-weight: 900;
}

.tape-brand,
.tape-length {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    border: $candy-border-w solid $mem-ink;
    border-radius: $candy-radius-xs;
    background-color: $mem-paper;
    color: $mem-ink;
    font-size: 0.8rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;
}

.tape-brand svg {
    width: 1rem;
    height: 1rem;
}

// The narrowest phones: the band holds the side, the glyph and the length, and
// the word goes (the heading above says it). Measured at 320 px, where the
// length sticker ran out of the label otherwise.
.tape-brand-word {
    @container rewind-tape (max-width: 18rem) {
        display: none;
    }
}

// The tape's length: C-90 on a shop tape, C-12014 on this one.
.tape-length {
    margin-left: auto;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    text-transform: none;

    small {
        font-size: 0.65rem;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
}

.tape-year {
    grid-area: year;
    display: flex;
    flex-direction: column;
    justify-self: start;
    padding-left: 1rem;
    font-size: 3.25rem;
    font-weight: 900;
    line-height: 0.9;
    font-variant-numeric: tabular-nums;

    small {
        margin-top: 0.45rem;
        font-size: 0.7rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: var(--look-tile-muted, #{$mem-text-muted-static});
    }

    @container rewind-tape (max-width: 36rem) {
        padding-left: 0.75rem;
        font-size: 2.5rem;
    }
}

// ---------------------------------------------------------------------------
// THE WINDOW — smoked glass through the label, and behind it the tape: two
// packs of wound tape, each on a reel. The packs are larger than the window and
// cut off by it, as on a real cassette. Drawn in the app's two weights only:
// no printed scale, no winding rings (both were hairlines).
// ---------------------------------------------------------------------------
.tape-window {
    --reel: 2.3rem;
    grid-area: window;
    position: relative;
    width: 12.5rem;
    height: 5rem;
    border: $candy-border-w solid $mem-ink;
    border-radius: $candy-radius-sm;
    background-color: $mem-ink;
    overflow: hidden;

    @container rewind-tape (max-width: 36rem) {
        --reel: 1.9rem;
        width: 10rem;
        height: 4.25rem;
    }

    @container rewind-tape (max-width: 21rem) {
        justify-self: center;
    }
}

// Wound tape: one brown disc in a 2 px ink ring. Its diameter is the full
// pack times `--pack-*`, so the rewind is a change of two numbers, and the
// ring stays 2 px at every size.
.tape-pack {
    --full: 6.25rem;
    position: absolute;
    z-index: 1;
    top: 50%;
    aspect-ratio: 1;
    border: $mem-ring-w solid $mem-ink;
    border-radius: 50%;
    background-color: var(--look-stat-bar, #{$mem-kraft});
    transform: translate(-50%, -50%);

    &.is-left {
        left: 25%;
        width: calc(var(--full) * var(--pack-left));
    }

    &.is-right {
        left: 75%;
        width: calc(var(--full) * var(--pack-right));
    }

    @container rewind-tape (max-width: 36rem) {
        --full: 5.25rem;
    }
}

// A reel: a paper hub whose six teeth reach into its hole, each as wide as the
// gap beside it, so they read at the app's own weight (16° teeth were
// hairlines; three broad ones read as a hazard sign). Placed by its corner,
// not by a transform, so the spin owns `transform` alone.
.tape-reel {
    position: absolute;
    z-index: 2;
    top: calc(50% - var(--reel) / 2);
    width: var(--reel);
    height: var(--reel);
    border: $mem-ring-w solid $mem-ink;
    border-radius: 50%;
    background-color: $mem-paper;

    &.is-left {
        left: calc(25% - var(--reel) / 2);
    }

    &.is-right {
        left: calc(75% - var(--reel) / 2);
    }

    // The teeth: six paper wedges on the dark hole …
    &::before {
        content: '';
        position: absolute;
        inset: 20%;
        border-radius: 50%;
        background-image: repeating-conic-gradient(#{$mem-paper} 0 30deg, #{$mem-ink} 30deg 60deg);
    }

    // … whose points the spindle hole covers, so only their roots show.
    &::after {
        content: '';
        position: absolute;
        inset: 38%;
        border-radius: 50%;
        background-color: $mem-ink;
    }
}

// ---------------------------------------------------------------------------
// THE NOTES — written on the label, one line each. No ruled lines: dashed
// hairlines were the finest strokes on the tape.
// ---------------------------------------------------------------------------
.tape-notes {
    grid-area: notes;
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: 0.4rem;
    min-width: 0;
    padding-right: 1rem;

    @container rewind-tape (max-width: 36rem) {
        padding-inline: 0.75rem;
    }
}

.tape-line {
    overflow: hidden;
    font-size: 0.95rem;
    white-space: nowrap;
    text-overflow: ellipsis;

    b {
        font-weight: 900;
        font-variant-numeric: tabular-nums;
    }

    &.is-blurb {
        font-weight: 700;
        white-space: normal;
    }
}

.tape-key {
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--look-tile-muted, #{$mem-text-muted-static});
}

// ---------------------------------------------------------------------------
// THE BRIDGE — the trapezoid at the foot of the shell, narrower at the top.
// The outline is an SVG path stretched over the box with a stroke that does
// not stretch (3 px, the plate weight), so its top edge sits exactly at the
// top. (A border seen in `perspective()` pulled the edge down by ~11 px, onto
// the holes.) Drawn in `currentColor`, so it flips with the shell. The tape
// runs across the foot.
// ---------------------------------------------------------------------------
.tape-bridge {
    position: relative;
    display: flex;
    // The holes sit in the upper part, clear of the tape below them.
    align-items: flex-start;
    justify-content: space-evenly;
    width: min(60%, 24rem);
    // The holes sit between the top edge and the tape, with room on both sides.
    height: 2.6rem;
    margin-top: 0.8rem;
    padding-top: 0.5rem;

    // The tape, running past the head: a band between two 2 px ink edges.
    &::after {
        content: '';
        position: absolute;
        left: 8%;
        right: 8%;
        bottom: 0.2rem;
        height: 0.6rem;
        background-color: var(--look-stat-bar, #{$mem-kraft});
        border-block: $mem-ring-w solid $mem-ink;
    }

    @container rewind-tape (max-width: 36rem) {
        width: 78%;
    }
}

.tape-bridge-edge {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    overflow: visible;

    path {
        fill: none;
        stroke: currentColor;
        stroke-width: $candy-border-w;
        stroke-linejoin: round;
        vector-effect: non-scaling-stroke;
    }
}

.tape-hole {
    position: relative;
    z-index: 1;
    // Centred on the screw head (1rem) beside it.
    margin-top: 0.08rem;
    border: $mem-ring-w solid currentColor;
    background-color: $mem-ink;

    &.is-round {
        width: 0.85rem;
        height: 0.85rem;
        border-radius: 50%;
    }

    &.is-square {
        width: 0.65rem;
        height: 0.65rem;
        border-radius: $candy-radius-xs;
    }
}

.tape-bridge .tape-screw {
    --slot: 60deg;
    position: relative;
    z-index: 1;
}
</style>
