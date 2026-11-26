<template>
    <!-- The way to Rewind (#527), kept for good at the foot of the stats page
         (#572): the latest finished year, seen or not. What announces a new
         Rewind is Home's January card; this is where it stays afterwards.
         A section like the others above it, with its own sticker heading.

         The door is a cassette (2026-11-25, chosen from four ideas; made
         plainer on 2026-11-26: "schlichteres Design"): the year as a tape that
         has played to its end. Shell, label and window, nothing more — no
         screws, no stickers, no bridge, one stripe. The label carries the side, the tape
         length in minutes (a C-90 holds ninety of them), the year and its
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
            <span class="tape-label">
                <span class="tape-band" aria-hidden="true">
                    <span class="tape-side">Side A</span>
                    <span v-if="teaser" :id="`${uid}-length`" class="tape-length">C-{{ tapeMinutes }} min</span>
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
                    <span v-for="side in ['is-left', 'is-right']" :key="side" class="tape-reel" :class="side">
                        <svg class="tape-hub" viewBox="-12 -12 24 24">
                            <circle class="tape-hub-hole" r="7.5" />
                            <path
                                class="tape-hub-teeth"
                                d="M0 -7.5V-6M6.5 -3.75L5.2 -3M6.5 3.75L5.2 3M0 7.5V6M-6.5 3.75L-5.2 3M-6.5 -3.75L-5.2 -3"
                            />
                        </svg>
                    </span>
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
// The label is a sticker on it and does not flip.
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
    padding: 1.4rem 1.6rem;
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
        padding: 1rem;
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

// One stripe across the top, with the side and the tape's length printed on
// it: C-90 on a shop tape, C-12014 on this one. Printed, not stuck on (the
// stickers and the second and third stripe went for a plainer tape). Boring
// has no accent fill there, so the stripe is plain and the print its grey.
.tape-band {
    grid-area: band;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    min-width: 0;
    padding: 0.45rem 1rem;
    border-bottom: $candy-border-w solid $mem-frame;
    background-color: var(--look-stat-label-fill, #{$mem-teal});
    color: var(--look-stat-label-text, #{$mem-ink});
    font-size: 0.75rem;
    font-weight: 900;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    white-space: nowrap;

    @container rewind-tape (max-width: 36rem) {
        padding-inline: 0.75rem;
    }
}

.tape-length {
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
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
        // Ink, not the static grey: on the dusk paper of the dark mode the
        // grey measured 4.0:1 at this size. Boring keeps its grey.
        color: var(--look-tile-muted, #{$mem-ink});
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
    border: $candy-border-w solid $mem-frame;
    border-radius: $candy-radius-sm;
    // Boring's tile is near black, so the ink glass would vanish into it; the
    // inlay token gives it a surface of its own there.
    background-color: var(--look-card-inlay-fill, #{$mem-ink});
    overflow: hidden;

    // Smaller hubs on phones, so the empty pack around them keeps a band of
    // tape wider than a line (1.9rem left 2.5–4 px of brown between two rings).
    @container rewind-tape (max-width: 36rem) {
        --reel: 1.6rem;
        width: 10rem;
        height: 4rem;
    }

    @container rewind-tape (max-width: 21rem) {
        justify-self: center;
    }
}

// Wound tape: one brown disc in a 2 px ink ring. Its diameter is the full
// pack times `--pack-*`, so the rewind is a change of two numbers, and the
// ring stays 2 px at every size.
.tape-pack {
    // The full pack keeps 4 px of glass to the side walls (at 6.25rem it touched
    // the wall and left slivers of ink beside it) and is cut decisively by the
    // top and bottom.
    --full: 5.5rem;
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
        --full: 4.25rem;
    }
}

// A reel: a paper hub in a 2 px ring, with a dark hole and six short teeth
// reaching into it. The teeth are strokes of constant 3 px width and stop
// well short of the centre, so the gaps between their tips stay wider than a
// line (wedges from a conic gradient tapered to 2 px; long teeth left 2 px
// slits of ink between their tips; three broad ones read as a hazard sign). Placed by its corner, not by a
// transform, so the spin owns `transform` alone.
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
}

.tape-hub {
    display: block;
    width: 100%;
    height: 100%;
}

.tape-hub-hole {
    fill: $mem-ink;
}

.tape-hub-teeth {
    fill: none;
    stroke: $mem-paper;
    stroke-width: $candy-border-w;
    stroke-linecap: butt;
    vector-effect: non-scaling-stroke;
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
    color: var(--look-tile-muted, #{$mem-ink});
}
</style>
