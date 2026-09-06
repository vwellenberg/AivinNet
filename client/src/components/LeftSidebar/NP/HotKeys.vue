<template>
    <div class="hotkeys">
        <button
            v-if="!isMobile"
            class="aux shuffle"
            :class="{ 'aux-off': !settings.shuffle }"
            :title="settings.shuffle ? 'Shuffle: random next track' : 'Shuffle off'"
            @click.prevent="queue.toggleShuffle"
        >
            <ShuffleSvg />
        </button>
        <button class="skip skip-prev" @click.prevent="queue.playPrev">
            <PrevSvg />
        </button>
        <button class="play" @click.prevent="queue.playPause">
            <Spinner v-if="buffering && queue.playing" />
            <PauseSvg v-else-if="queue.playing" />
            <PlaySvg class="playsvg" v-else />
        </button>
        <button class="skip" @click.prevent="queue.playNext">
            <NextSvg />
        </button>
        <button
            v-if="!isMobile"
            class="aux repeat"
            :class="{ 'aux-off': settings.repeat === 'none' }"
            :title="settings.repeat === 'all' ? 'Repeat all' : settings.repeat === 'one' ? 'Repeat one' : 'No repeat'"
            @click.prevent="settings.toggleRepeatMode"
        >
            <RepeatOneSvg v-if="settings.repeat === 'one'" />
            <RepeatAllSvg v-else />
        </button>
    </div>
</template>

<script setup lang="ts">
import { buffering } from '@/stores/player'
import { isMobile } from '@/stores/content-width'
import useQStore from '@/stores/queue'
import useSettings from '@/stores/settings'

import { default as NextSvg, default as PrevSvg } from '@/assets/icons/next.svg'
import PauseSvg from '@/assets/icons/pause.svg'
import PlaySvg from '@/assets/icons/play.svg'
import ShuffleSvg from '@/assets/icons/shuffle.svg'
import RepeatAllSvg from '@/assets/icons/repeat.svg'
import RepeatOneSvg from '@/assets/icons/repeat-one.svg'
import Spinner from '@/components/shared/Spinner.vue'

const queue = useQStore()
const settings = useSettings()
</script>

<style lang="scss">
// TRANSPORT — five controls, ONE footprint.
//
// Every button here is $bar-control (44px) square with a $bar-glyph icon, from
// Global/_buttons.scss. Before this the row held 32px aux buttons next to 36px
// skips next to a 40px play, each with its own glyph size, because each control
// sized itself. The sizes are read, not restated: "uniform" is only true if
// there is one place to change.
//
// The roles carry the rest — shuffle/repeat and prev/next are `action` (panel
// plate, ink frame, offset shadow, hatch), play/pause is `primary` (the teal
// box), and an active shuffle/repeat is the yellow toggle box.
.hotkeys {
    display: flex;
    align-items: center;
    justify-content: center;
    // The value this row already had, now under its name — it is the one the
    // other bar groups were brought to, so it should not be the one place that
    // still spells it out.
    gap: $bar-gap;
    height: 100%;

    // prev / next / shuffle / repeat — plated, like every other pressable
    // surface in this design (styling.md: the hatch means "you can press
    // this", and it needs a fill to sit on). They were bare glyphs while the
    // play button was the only control in the bar with a plate; that made the
    // bar the one place where "pressable" was not readable at rest.
    .skip,
    .aux {
        @include btn-action($size: $bar-control);
        // The transport glyphs are currentColor (filled play/pause/skip,
        // stroked shuffle/repeat) — drive them from `color` so they read on
        // the panel bar in BOTH themes (ink on light, paper on dark). Never
        // `fill` here: that would flood the stroked glyphs solid.
        color: $candy-text;

        svg {
            transition: opacity 0.15s ease, transform 0.1s ease;
        }
    }

    .skip-prev svg {
        transform: rotate(180deg);
    }

    // play / pause — the primary role: teal memphis box, ink glyph, sprinkle.
    // Hover deliberately does NOT flip to yellow any more: in this design
    // system yellow means "active" (playing row, shuffle on, repeat on), and
    // the play button borrowing it for hover was the one place that conflated
    // the two signals.
    .play {
        @include btn-primary(
            $w: $bar-control,
            $h: $bar-control,
            $pad: 0,
            $glyph: $bar-glyph-play
        );

        .spinner {
            // Above the sprinkle overlay, like the glyph.
            position: relative;
            z-index: 1;
        }

        // Optically centre the play triangle inside the box.
        .playsvg {
            transform: translateX(1px);
        }
    }

    // Off is a STATE, so it stays dimmed — that is the only opacity left in
    // the row. Idle prev/next used to be dimmed to 0.7 as decoration, which
    // made "unavailable" and "just sitting there" look the same.
    .aux-off svg {
        opacity: 0.45;
    }

    // Active shuffle / repeat: the yellow memphis box (v1.4.0 decision, kept).
    // The footprint is unchanged between off and on — reserved by the quiet
    // role above — so toggling can never shove the row sideways. The role owns
    // hover too (#422): the hand-written one here was still blush, the old
    // pointer colour.
    .aux.shuffle:not(.aux-off),
    .aux.repeat:not(.aux-off) {
        @include btn-toggle-on;
    }

    @include allPhones {
        // The same 0.75rem this used to spell out — under its name now. It is
        // the value `$bar-gap-tight` already stood for, and a literal in a
        // breakpoint block is where the bar's unowned gaps kept surviving.
        gap: $bar-gap-tight;

        .skip-prev {
            margin-left: $small;
        }
    }

    // The narrowest phones cannot fit five controls — prev/next give way so
    // play/pause keeps its full touch target. Scoped to the transport: the
    // blanket `.b-bar button:first-child` this replaces also matched the mute
    // button (first child of .volume-control) and the mobile repeat button,
    // hiding both by accident.
    @include smallestPhones {
        .skip {
            display: none;
        }
    }
}
</style>
