<template>
    <div class="now-playing-header">
        <div class="centered">
            <PlayingFrom />
            <RouterLink
                :to="{
                    name: Routes.album,
                    params: {
                        albumhash: queue.currenttrack?.albumhash || ' ',
                    },
                }"
                title="Go to Album"
                class="np-image lauflicht-rim"
            >
                <img v-motion-fade class="rounded" :src="paths.images.thumb.large + queue.currenttrack?.image" />
            </RouterLink>
            <NowPlayingInfo @handle-fav="handleFav" />
            <Progress v-if="isMobile" />
            <!-- Every child here is gated on isMobile/isSmallPhone, so on a
                 desktop this was an empty 0px div still contributing its
                 `margin-top: 1rem`. Invisible on the bare ground, but the veil
                 plate below makes it 16px of dead air inside the card. Safe
                 gate: isSmallPhone (<=660) is a subset of isMobile (<=900). -->
            <div v-if="isMobile" class="below-progress">
                <div v-if="isMobile" class="time">
                    {{ formatSeconds(queue.duration.current) }}
                </div>
                <Buttons v-if="isSmallPhone" :hide-heart="true" :hide-volume="true" @handleFav="() => {}" />
                <div v-if="isMobile" class="time">
                    {{ formatSeconds(queue.duration.full) }}
                </div>
            </div>
            <div v-if="isMobile" class="np-devices">
                <!-- On mobile the bottom bar swaps the aux group for navigation,
                     so this is the only place a phone can reach group playback.
                     Small phones already get the full aux group above. -->
                <DevicesButton v-if="!isSmallPhone" />
            </div>
            <!-- `isMobile`, not `isSmallPhone`: this is the only volume SLIDER
                 a phone has (the one in the bar is hidden there), and gating it
                 at 660px meant turning the device to landscape — ~900px — took
                 it away. Someone hunting for the volume control lost it by
                 looking for it. -->
            <Volume v-if="isMobile" class="np-volume" />
        </div>
        <h3 v-if="queue.next" class="nowplaying_title">Up Next</h3>
        <SongItem
            v-if="queue.next"
            :track="queue.next"
            :index="queue.nextindex + 1"
            :is_first="true"
            :is_last="true"
            :source="dropSources.folder"
            @play-this="queue.playNext"
        />
        <h3 class="nowplaying_title">
            Queue
            <!-- The rows under this caption ARE `tracklist` (see the scroller in
                 views/NowPlaying/main.vue), so its length is the queue's length —
                 not a separate count that could drift from what is listed.

                 `aria-hidden`: inside the <h3> the number would become part of
                 the heading's accessible name ("Queue 43") and change on every
                 queue mutation, so heading navigation would announce a moving
                 target. The count is a visual shorthand for the numbered rows
                 right below it — which a screen reader reads anyway. -->
            <span v-if="tracklist.tracklist.length" class="queue-count" aria-hidden="true">{{
                tracklist.tracklist.length
            }}</span>
        </h3>
    </div>
</template>

<script setup lang="ts">
import { paths } from '@/config'
import { dropSources, favType } from '@/enums'
import favoriteHandler from '@/helpers/favoriteHandler'
import { Routes } from '@/router'
import { isMobile, isSmallPhone } from '@/stores/content-width'
import useQueueStore from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import { formatSeconds } from '@/utils'

import Progress from '@/components/LeftSidebar/NP/Progress.vue'
import Buttons from '../BottomBar/Right.vue'
import Volume from '../BottomBar/Volume.vue'
import SongItem from '../shared/SongItem.vue'
import NowPlayingInfo from './NowPlayingInfo.vue'
import PlayingFrom from './PlayingFrom.vue'

const queue = useQueueStore()
const tracklist = useTracklist()

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
.now-playing-header {
    padding-bottom: $smaller;
    position: relative;

    .nowplaying_title {
        // "Up Next" and "Queue" were the last captions in the app still standing
        // free on the doodle ground — the readability failure `mem-sticker`
        // exists to answer, and which every other section caption (Browse
        // Library, Top Tracks, the playlist groups, See all) already opted into.
        // They were simply never added to that list.
        @include mem-sticker;
        // No left inset: the chip's leading edge is the page's leading edge.
        //
        // The 1rem (0.5rem on narrow layouts) that stood here is what an inset
        // is FOR on bare text — keeping a word off the edge. A sticker carries
        // that gap inside itself as the chip's own padding, so the margin was
        // left over from the bare-text era and did the one thing a caption must
        // not do: push its plate out of line with the rows it labels. Measured
        // on the deployed app — rows at 303, captions at 319 (desktop) and
        // 31/39 in the narrow column — while every other caption in the app
        // (Browse Library, the card rows, Top Tracks) sits flush on the same
        // 303. `margin-top`/`margin-bottom` are the air between the sections
        // and stay. See .claude/rules/styling.md.
        margin: 1.25rem 0;
        // The caption is a flex line so the count badge can sit on the same
        // baseline box; identical rendering for the caption that has none.
        display: inline-flex;
        align-items: center;
        gap: $small;

        &:last-child {
            // Was `padding-top: $large` + `margin: 1rem 0` = 2.5rem of air above
            // the Queue caption. Kept as one margin so the chip stays the same
            // height as the Up Next chip above it.
            margin-top: 2.5rem;
            margin-bottom: 1rem;
        }
    }

    // How many tracks are queued — the shared count chip, in track yellow.
    .queue-count {
        @include mem-count-chip('track');
    }

    .below-progress {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 1rem;

        .time {
            font-size: $medium;
            font-weight: 500;
            color: $candy-text;
            background-color: $candy-pink-soft;
            border: 1px solid $mem-line;
            padding: 1px $smaller;
            min-width: 2.5rem;
            text-align: center;
            border-radius: $smaller;
            font-variant-numeric: tabular-nums;
        }

        /* Responsive */
        @include allPhones {
            .right-group button.speaker {
                border-top: 1px solid transparent !important;
                border-top-left-radius: 0 !important;
                border-top-right-radius: 0 !important;
            }
        }

        @include smallestPhones {
            position: relative;
            flex-direction: column;
            align-items: unset;
            gap: $small;

            .time:first-child {
                align-self: baseline;
                margin-left: 4px;
            }

            .time:last-child {
                align-self: end;
                position: absolute;
                top: 0;
                right: 4px;
            }

            .right-group {
                width: 100% !important;
                display: flex;
                justify-content: space-between;
            }
        }
    }

    // Volume gets its own full-width row in the mobile Now Playing view. In the
    // bottom bar the slider styling is .b-bar-scoped (and hidden on mobile), so
    // here the standalone control is styled explicitly: speaker icon + an
    // accessible horizontal slider on its own line (instead of being crammed —
    // and the slider mis-rendered — into the repeat/shuffle/lyrics row).
    .np-volume {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        margin-top: 0.85rem;
        padding: 0 0.25rem;

        // Same quiet role and same footprint as every other player control —
        // this is a phone screen, so 2.25rem was well under the touch target.
        .speaker-icon {
            @include btn-quiet($size: $bar-control, $glyph: $bar-glyph);
            color: $candy-text;

            // ...and the same state box as everywhere else the speaker lives
            // (BottomBar/Volume.vue), so silence looks the same on every
            // surface instead of being loud in the bar and quiet here.
            &.silent {
                @include btn-toggle-on;
            }
        }

        // Track pill, border and the white bordered thumb come from the global
        // range styling; only the flat teal played-volume fill is painted here
        // (clipped by the inline background-size from Volume.vue).
        .volume-slider {
            flex: 1;
            margin-right: 0; // neutralise the global range's 15px right margin
            background-image: linear-gradient($mem-teal, $mem-teal);
            background-repeat: no-repeat;
            // background-size is set inline from the current volume (Volume.vue).
        }
    }

    // (Group playback, mobile-only. The button's box used to be written out
    // here — 44px, radius, glyph size, but no ROLE, so it rendered as a bare
    // glyph on this screen too. Footprint and look both come from
    // DevicesButton.vue now; `.np-devices` only places it.)

    .centered {
        margin: 0 auto;
        width: 26rem;
        max-width: 100%;

        // One plate under the whole head, not one per part.
        //
        // Every piece in here already carried its own surface — the source
        // sticker, the cover's ink frame, the title plate — so nothing was
        // unreadable and `--mem-veil`'s usual job (text on the doodle ground)
        // did not apply. What was missing is the opposite: with the doodles
        // running at full volume BETWEEN them, four plates read as four
        // unrelated objects rather than as one now-playing card. Measured at
        // 1400x950 on the deployed app; the ground is a 3840x1600 tile, so
        // there is always something loud in the gaps.
        //
        // Veil rather than panel, and that is the rule: this is content, not
        // chrome. It stays 92% opaque, so the ground still shows through — the
        // doodles are dimmed, not deleted.
        // Through the mixins, not written out: a central change to the radius,
        // the border or the offset would otherwise leave this one plate behind,
        // and no census covers it.
        @include candy-box(var(--mem-veil));
        @include candy-shadow;
        padding: 1.25rem;
    }

    .np-image {
        position: relative;
        display: block;
        margin-bottom: 1rem;
        // Match the cover's corner radius so the Lauflicht rim (border-radius:
        // inherit) traces the rounded image edge instead of a square.
        border-radius: 1rem;

        img {
            width: 100%;
            // Square the cover deterministically so the .np-image box — and the
            // Lauflicht rim drawn on it (inset:0) — hugs the image on every
            // device. height:100% resolved against this auto-height parent, which
            // is undefined: some devices left a gap so the rim missed the cover.
            height: auto;
            aspect-ratio: 1;
            max-width: 30rem;
            object-fit: cover;
            display: block;
            border: $candy-border;
        }
    }

    // Finger geometry, same as the phone bottom bar.
    //
    // This bar is rendered `v-if="isMobile"`, so it only ever exists on a touch
    // screen — and it used to carry the SMALLEST knob in the whole app (0.8rem,
    // against the 1.1rem the mouse-driven one had back then). It also set the
    // height alone and left the width at that value, so `border-radius: 50%`
    // drew an ellipse rather than a circle. See #284.
    .progress-wrap {
        @include range-geometry(1.25rem, 1.6rem);
        // The gap belongs to the WRAPPER, not to the input inside it.
        //
        // The input is an inline-block, so its margin box counts towards the
        // wrapper's line box: a `margin-top` on the input made the wrapper 1rem
        // taller at the top without moving the input's own centre, leaving the
        // two centres 7px apart. The knob and track centre on the input, but
        // the texture overlay centres on the WRAPPER — so the texture drifted
        // up out of the bar. It went unnoticed while the strip was 3.6px; at
        // the touch height it is 14px and straddles the top ink border.
        margin-top: 1rem;
    }

    #progress {
        margin-right: 0;
        touch-action: none;
    }
}
</style>