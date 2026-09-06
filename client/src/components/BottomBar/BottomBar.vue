<template>
    <div class="b-bar">
        <LeftGroup @handleFav="handleFav" />
        <div class="center">
            <div v-if="!isMobile" class="with-time">
                <div class="time time-current">
                    <div class="numbers">
                        {{ formatSeconds(queue.duration.current || 0) }}
                    </div>
                </div>

                <div class="buttons rounded-sm border">
                    <HotKeys />
                </div>
                <div class="time time-full">
                    <div class="numbers">
                        {{ formatSeconds(queue.duration.full) }}
                    </div>
                </div>
            </div>
            <Progress />
        </div>
        <RightGroup v-if="!isMobile" @handleFav="handleFav" />
        <Navigation v-else />
        <!-- Autoplay-block overlay for remote group joins; the bottom bar is
             always mounted, which makes it a reliable host. -->
        <GestureOverlay />
    </div>
</template>

<script setup lang="ts">
import { favType } from '@/enums'
import favoriteHandler from '@/helpers/favoriteHandler'
import { isMobile } from '@/stores/content-width'
import { formatSeconds } from '@/utils'

import useQStore from '@/stores/queue'

import GestureOverlay from '@/components/DeviceSync/GestureOverlay.vue'
import HotKeys from '@/components/LeftSidebar/NP/HotKeys.vue'
import Progress from '@/components/LeftSidebar/NP/Progress.vue'
import Navigation from '@/components/LeftSidebar/NavButtons.vue'

import LeftGroup from './Left.vue'
import RightGroup from './Right.vue'

const queue = useQStore()

function handleFav() {
    favoriteHandler(
        queue.currenttrackIsFav,
        favType.track,
        queue.currenttrack?.trackhash || '',
        () => null,
        () => null
    )
}
</script>

<style lang="scss">
.b-bar {
    display: grid;
    grid-template-columns: 1fr max-content 1fr;
    align-items: center;
    z-index: 1;
    // Moved here from the deleted assets/scss/BottomBar/BottomBar.scss, which
    // was the only other owner of `.b-bar`. The rest of that file styled
    // `.controlsx`, `.durationx`, `.progress-bottom` and `.r-group` — none of
    // which this markup renders any more — so this line was all that was left
    // of it. One owner for `.b-bar` now.
    height: 100%;
    // Side inset for the NP block / volume group. Used to be an inline style
    // gated on is_default_layout, which left the alternate (links) layout with
    // zero padding — the NP cover sat flush against the window edge.
    padding: 0 1rem;

    @include allPhones {
        display: flex;
        flex-direction: column;
        align-items: unset;
        gap: $small;
        padding: $medium 1rem;

        // The seek bar used to be decoration on phones: a 1px line, the whole
        // .center block set to `pointer-events: none`, and the thumb hidden on
        // :hover — which on a touch screen sticks after the first tap, so the
        // knob vanished as soon as you touched it and could never be dragged.
        // It is a real control now: a touch-sized track, a visible knob, and
        // `touch-action: none` so a horizontal drag scrubs instead of being
        // swallowed as a page scroll/swipe.
        // A slider is the one control that stays thinner than 44px — the knob
        // is what the finger goes for, so the track carries the bar and the
        // knob is oversized against it. Set on the wrapper, so the texture
        // overlay inside it follows the same geometry; the centring falls out
        // of the two numbers (see `range-geometry` in _candy.scss).
        .center .progress-wrap {
            @include range-geometry(1.25rem, 1.6rem);
        }

        .center #progress {
            touch-action: none;
        }
    }

    // A landscape phone: the same three blocks the phone stacks — track,
    // seek bar, navigation — laid out side by side instead. There is width to
    // spare sideways and none of the height, and the DOM order already is
    // left-group · center · navigation, so this is a direction change rather
    // than a rebuild. 9.5rem of bar becomes 3.75rem.
    //
    // Transport stays inside `.left-group` (it is a phone bar, and there the
    // HotKeys sit with the track block) — see BottomBar/Left.vue.
    @include shortViewport {
        flex-direction: row;
        align-items: center;
        gap: $medium;
        padding: 0 1rem;

        .left-group {
            // Grows, but not without limit: past ~20rem the seek bar would be
            // the first thing squeezed, and it is the control here.
            flex: 1 1 20rem;
            max-width: 26rem;
            min-width: 0;
        }

        .center {
            flex: 1 1 11rem;
            min-width: 7rem;
        }

        .side-nav-container {
            flex: 0 0 auto;
            width: auto;
        }
    }

    // There is deliberately no `.b-bar button { … }` rule here any more.
    //
    // It used to hand every descendant button a 3rem width, a transparent fill
    // and a hover — on top of whatever HotKeys, Right.vue and Volume.vue were
    // each setting for the same buttons, which is how one bar came to hold four
    // heights and four glyph sizes. Worse, it reached things it was never
    // aimed at: `:first-child` also matched the mute button (first child of
    // .volume-control) and the mobile repeat button, so the narrowest phones
    // silently lost their mute control.
    //
    // Each control group now owns its own controls, and all of them read the
    // shared $bar-control / $bar-glyph tokens from Global/_buttons.scss.

    &:hover {
        // The seek knob is deliberately NOT resized here any more.
        //
        // The rule that used to live here shrank it from 1.1rem to 1rem, and
        // its trigger was `.b-bar` — the whole bar. Hovering the title, the
        // transport buttons or the clock made the knob twitch, which is what
        // the bug report described. It dates from a time when the knob was
        // hidden at rest and this was meant to reveal it; it is always visible
        // now, so all that was left of it was the twitch. See #284.

        // INFO: Show the expand button
        .np-image .expandicon {
            opacity: 1;
        }
    }

    .with-time {
        display: grid;
        grid-template-columns: max-content 1fr max-content;
        align-items: center;
        // No fixed height: the row sizes to the play button so its rounded
        // edges are never clipped. A short fixed height + scaled buttons +
        // overflow:hidden used to crop the transport icons.
    }

    .center {
        display: grid;
        align-items: center;
        gap: 0.625rem;

        width: 30rem;

        @media only screen and (max-width: 1080px) {
            width: 20rem !important;
        }

        @include allPhones {
            width: 100% !important;
            // No negative side margins any more: the bar used to be pulled to
            // the full viewport width (100vw), which cut the knob off at both
            // ends — exactly where you grab it to seek to the start or end.
            margin: 4px 0;
            user-select: none;

            // #progress is wrapped in .progress-wrap (#66), so target it as a
            // descendant instead of a direct child.
            #progress {
                width: 100%;
                margin: unset;
            }
        }

        .time {
            font-weight: 500;
            font-size: $medium;
            color: $candy-text;

            .numbers {
                // Plain time text, no pill/box background (Spotify).
                font-variant-numeric: tabular-nums;
            }
        }
    }

    // hotkey
    .buttons {
        display: grid;
        place-items: center;
        border: none;
    }
}
</style>
