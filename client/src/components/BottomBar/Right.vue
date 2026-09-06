<template>
    <div class="right-group">
        <!-- On desktop shuffle/repeat live in the centre transport and the
             heart sits next to the track title; here they only appear on
             mobile, where all controls are crammed into one group. -->
        <template v-if="isMobile">
            <button
                class="aux repeat"
                :class="{ 'aux-off': settings.repeat == 'none' }"
                :title="settings.repeat == 'all' ? 'Repeat all' : settings.repeat == 'one' ? 'Repeat one' : 'No repeat'"
                @click="settings.toggleRepeatMode"
            >
                <RepeatOneSvg v-if="settings.repeat == 'one'" />
                <RepeatAllSvg v-else />
            </button>
            <button
                class="aux shuffle"
                :class="{ 'aux-off': !settings.shuffle }"
                :title="settings.shuffle ? 'Shuffle: random next track' : 'Shuffle off'"
                @click="queue.toggleShuffle"
            >
                <ShuffleSvg />
            </button>
            <HeartSvg
                v-if="!hideHeart"
                btn_role="bar"
                title="Favorite"
                :state="queue.currenttrackIsFav"
                @handleFav="() => $emit('handleFav')"
            />
        </template>
        <LyricsButton />
        <DevicesButton />
        <Volume v-if="!hideVolume" />
    </div>
</template>

<script setup lang="ts">
import useQueue from '@/stores/queue'
import useSettings from '@/stores/settings'
import { isMobile } from '@/stores/content-width'

import RepeatOneSvg from '@/assets/icons/repeat-one.svg'
import RepeatAllSvg from '@/assets/icons/repeat.svg'
import ShuffleSvg from '@/assets/icons/shuffle.svg'
import DevicesButton from '../DeviceSync/DevicesButton.vue'
import HeartSvg from '../shared/HeartSvg.vue'
import LyricsButton from '../shared/LyricsButton.vue'
import Volume from './Volume.vue'

const queue = useQueue()
const settings = useSettings()

defineProps<{
    hideHeart?: boolean
    // In the Now Playing view the volume gets its own dedicated row (see
    // NowPlaying/Header.vue), so it is suppressed in this control group there.
    hideVolume?: boolean
}>()

defineEmits<{
    (event: 'handleFav'): void
}>()
</script>

<style lang="scss">
.right-group {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    // The bar's own spacing token. This group stood at 2px against the
    // transport row's 20 — measured, not estimated — which is invisible while
    // every glyph carries its own padding and unmissable the moment these
    // buttons get a fill.
    gap: $bar-gap;
    height: 4rem;

    @include allPhones {
        width: max-content;
        height: unset;
    }

    // Every control in this group (repeat, shuffle, lyrics, devices, volume
    // speaker) shares the transport's footprint and glyph size — the same
    // $bar-control / $bar-glyph the centre transport reads, so the two halves
    // of the bar cannot drift apart again.
    //
    // Two exclusions, both because they bring their own complete anatomy:
    // HeartSvg (it takes its own role, plus a teal favourited state) and the
    // devices button (plate at rest, green toggle box when joined — the whole
    // thing owned by DevicesButton.vue). Spelled out rather than left to
    // specificity luck.
    //
    // ⚠️ The devices exclusion used to read `:not(.ds-joined)`, i.e. it carved
    // out the STATE rather than the control — so the plating below reached the
    // idle button here while the phone bar stripped it back to a bare glyph,
    // and the same component was two different buttons on two screens.
    //
    // ⚠️ The heart's exclusion used to be a hole in this rule rather than a
    // delegation: its role rendered a header-sized 54x36 box, so the one
    // control carved out of the row's sizing rule was the one that then did not
    // match the row. It takes `btn_role="bar"` at the call site now, which
    // reads the SAME `$bar-control` this rule does — the carve-out is about
    // colour and state, not about size.
    > button:not(.heart-button):not(.devices-btn) {
        @include btn-action($size: $bar-control);
        // The control glyphs are currentColor (filled bodies, stroked details)
        // — colour them through `color`, never `fill`, or the stroked ones
        // (shuffle, repeat, lyrics) get flooded solid.
        color: $candy-text;
    }

    button.aux.aux-off svg {
        opacity: 0.45;
    }

    // Active shuffle / repeat wear the yellow memphis box, mirroring the
    // desktop transport (LeftSidebar/NP/HotKeys.vue). The footprint is already
    // reserved by the plated role above, so switching on changes colour only —
    // it used to also resize the button from 3rem to 2.5rem, which shoved its
    // neighbours on every toggle. Hover comes with the role (#422); the copy
    // here was still blush, the old pointer colour.
    button.aux:not(.aux-off) {
        @include btn-toggle-on;
    }
}
</style>
