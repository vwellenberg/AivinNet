<template>
    <!-- The way to Rewind (#527), kept for good at the foot of the stats page
         (#572): the latest finished year, seen or not. What announces a new
         Rewind is Home's January card; this is where it stays afterwards.
         A section like the others above it, with its own sticker heading.
         The plate is the door (2026-11-25): the year large, a taste of it
         (minutes, plays, top artist), an arrow. Once there are many years,
         one tile per year on a shelf takes its place. -->
    <section v-if="year" class="rewind-section">
        <h3 class="section-title">Rewind</h3>
        <RouterLink
            class="rewind-door"
            :to="{ name: Routes.Rewind, params: { year } }"
            :aria-label="`Your ${year} Rewind`"
        >
            <span class="rewind-door-year">
                {{ year }}
                <small>Rewind</small>
            </span>
            <span v-if="teaser" class="rewind-door-facts">
                <span class="rewind-door-fact">
                    <b>{{ minutes(teaser.seconds) }}</b>
                    <span>minutes</span>
                </span>
                <span class="rewind-door-fact">
                    <b>{{ teaser.plays.toLocaleString('en') }}</b>
                    <span>plays</span>
                </span>
                <span v-if="teaser.top_artists[0]" class="rewind-door-fact">
                    <b>{{ teaser.top_artists[0].name }}</b>
                    <span>top artist</span>
                </span>
            </span>
            <span v-else class="rewind-door-facts">
                <span class="rewind-door-blurb">Your year in music, played back: top tracks, artists and your biggest day.</span>
            </span>
            <span class="rewind-door-go" aria-hidden="true"><ArrowIcon /></span>
        </RouterLink>
    </section>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

import ArrowIcon from '@/assets/icons/right-arrow.svg'
import { getRewind } from '@/requests/stats'
import { Routes } from '@/router'
import { RewindPayload, minutes } from '@/utils/rewind'

const props = defineProps<{ year: number | null | undefined }>()

// The taste of the year comes from the Rewind itself (the server keeps the
// latest one built). Without it the door still opens, with a line of text.
const teaser = ref<RewindPayload | null>(null)

watch(
    () => props.year,
    async year => {
        teaser.value = null
        if (!year) return
        try {
            const res = await getRewind(year)
            if (res.status === 200 && res.data?.year === year && res.data.plays) teaser.value = res.data
        } catch {
            // The door without its numbers.
        }
    },
    { immediate: true }
)
</script>

<style lang="scss" scoped>
.rewind-section {
    // Under the calendar and the records, as far from them as they are from each other.
    margin-top: 2rem;
}

.section-title {
    @include mem-sticker;
    margin: 0 0 1rem 0;
    font-size: 1.15rem;
    font-weight: 700;
}

// The Rewind page's own head plate (lavender, ink in both modes; Boring's tile), here as a
// door: the whole plate is the link, so it lifts under the pointer and its
// arrow wears the play colour.
.rewind-door {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 1.5rem;
    padding: 1rem 1.25rem;
    // Boring keeps Stats sober: its tile panel instead of the lavender.
    background-color: var(--look-tile-fill, #{mem-pastel($mem-lavender)});
    border: $candy-border;
    border-radius: $candy-radius;
    @include candy-raised($press: false);
    color: var(--look-tile-text, #{$mem-ink});
    text-decoration: none;
    @include focus-ring;

    @include allPhones {
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 1rem;
    }
}

.rewind-door-year {
    display: flex;
    flex-direction: column;
    font-size: 3.5rem;
    font-weight: 900;
    line-height: 0.9;
    font-variant-numeric: tabular-nums;

    small {
        margin-top: 0.4rem;
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
}

.rewind-door-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.75rem;
    min-width: 0;

    @include allPhones {
        grid-column: 1 / -1;
        grid-row: 2;
    }
}

.rewind-door-fact {
    display: flex;
    flex-direction: column;
    min-width: 0;

    b {
        overflow-wrap: anywhere;
        font-size: 1.35rem;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
    }

    span {
        font-size: 0.75rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        // Ink, not the grey: on the lavender of the dark mode the grey sank.
        color: var(--look-tile-muted, #{$mem-ink});
    }
}

.rewind-door-blurb {
    font-weight: 700;
}

// Drawn as the play button (teal, ink glyph), not a second control: the
// plate around it is the target.
.rewind-door-go {
    display: grid;
    place-items: center;
    width: $bar-control;
    height: $bar-control;
    border: $candy-border;
    border-radius: 50%;
    background-color: var(--look-play-fill, #{$mem-teal});
    color: var(--look-play-glyph, #{$mem-ink});
    box-shadow: mem-shadow(3px, 3px);

    svg {
        width: $glyph-lone;
        height: $glyph-lone;
    }
}
</style>
