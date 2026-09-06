<template>
    <div v-auto-animate class="left-group">
        <!-- The track row's meter always sits on the yellow playing row, where
             an accent cannot clear 3:1 (see #357). Here the ground is the dark
             panel, so this is the one place the coral peak is legible. Desktop
             only: the phone bar already trades this space for navigation. -->
        <!-- Guard on the hash, not on `currenttrack`: that getter answers an
             empty queue with `{} as Track`, which is truthy, so the meter would
             stand next to the "Hello there" placeholder on a fresh session.
             Decorative here — the title and the transport already say it, and
             the track row's meter is the one that carries the label. -->
        <PlayingMeter
            v-if="!isMobile && queue.currenttrackhash"
            class="bar-meter"
            :playing="queue.playing"
            decorative
        />
        <!-- The cover is unconditional now. It used to swap for a SECOND heart
             whenever the left sidebar carried its own large artwork — a trade
             that stopped making sense twice over: the sidebar art is gone, and
             the row already ends in a heart a few elements down, so switching
             it on put two of them in the same bar. -->
        <RouterLink
            title="Go to Now Playing"
            :to="{
                name: Routes.nowPlaying,
                params: {
                    tab: 'home',
                },
                replace: true,
            }"
            class="np-image lauflicht-rim rounded-sm no-scroll"
        >
            <img :src="paths.images.thumb.small + queue.currenttrack?.image" alt="" />
            <div class="expandicon">
                <ExpandSvg />
            </div>
        </RouterLink>
        <div class="track-info">
            <div v-tooltip class="title">
                <span class="ellip">
                    {{ queue.currenttrack?.title || 'Hello there' }}
                </span>
                <ExplicitIcon class="explicit-icon" v-if="queue.currenttrack?.explicit" />
                <MasterFlag :bitrate="queue.currenttrack?.bitrate || 0" />
            </div>
            <ArtistName
                :artists="queue.currenttrack?.artists || []"
                :albumartists="queue.currenttrack?.albumartists || 'Welcome to AivinNet'"
                class="artist"
            />
        </div>
        <HeartSvg
            v-if="!isMobile"
            class="np-fav"
            btn_role="bar"
            title="Favorite"
            :state="queue.currenttrackIsFav"
            @handleFav="$emit('handleFav')"
        />
        <!-- Silence is a dead end on a small phone: this bar has no volume
             control (the right group is the navigation there), so the only
             speaker in the app sits far down the Now Playing page — and a
             muted state is persisted, or arrives from another device in a
             group session. Whenever there is no sound, the way back is right
             here on every page; when there is, nothing is shown and the bar
             keeps its room for the track title. -->
        <button
            v-if="phoneBar && settings.is_silent"
            class="bar-unmute"
            title="Unmute"
            @click="settings.toggleMute"
        >
            <VolumeMuteSvg />
        </button>
        <!-- Not in a short viewport. A landscape phone is the SAME device as a
             portrait one, and portrait has never had this group: it falls in
             the 660-900px band only because it is turned over, and then gets
             repeat, shuffle, favourite, lyrics, devices and volume that the
             upright phone does without. Dropping it here is not taking
             something away from landscape, it is ending an inconsistency —
             measured, the bar held 9 controls sideways against 4 upright. -->
        <Actions v-if="!phoneBar && isLargerMobile" @handleFav="$emit('handleFav')" />
        <HotKeys v-if="isMobile" />
        <!-- Small phones only get HotKeys here (Actions covers the larger ones),
             so without this the Devices button was buried in the Now Playing
             view and unreachable from the bar itself.

             It steps aside while the player is silent, and that is a decision
             about which of the two matters more in that moment. Five controls
             do not fit a 360px phone: cover 48 + unmute 44 + transport 164 +
             devices 44 is 300 of the 328 available, which left the title 12px
             and its text ran straight under the unmute box. Silence means
             nothing is audible anywhere, so "get the sound back" outranks "play
             this in sync with another device" — and Devices stays reachable on
             the Now Playing page, which is where it lived before it was added
             here. -->
        <DevicesButton v-if="phoneBar && !settings.is_silent" />
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { paths } from '@/config'
import { Routes } from '@/router'

import { isLargerMobile, isMobile, isShort } from '@/stores/content-width'
import useQStore from '@/stores/queue'
import useSettingsStore from '@/stores/settings'

import ExpandSvg from '@/assets/icons/expand.svg'
import VolumeMuteSvg from '@/assets/icons/volume-mute.svg'
import ArtistName from '@/components/shared/ArtistName.vue'
import DevicesButton from '../DeviceSync/DevicesButton.vue'
import HotKeys from '../LeftSidebar/NP/HotKeys.vue'
import HeartSvg from '../shared/HeartSvg.vue'
import MasterFlag from '../shared/MasterFlag.vue'
import PlayingMeter from '../shared/PlayingMeter.vue'
import Actions from './Right.vue'
import ExplicitIcon from '@/assets/icons/explicit.svg'

const queue = useQStore()
const settings = useSettingsStore()

/**
 * This bar is the PHONE bar: cover, title, transport, and one of unmute /
 * devices — the four controls an upright phone has always had.
 *
 * The 660-900px band (`isLargerMobile`) otherwise gets the richer group with
 * repeat, shuffle, favourite, lyrics, devices and volume. A landscape phone
 * lands in that band purely because it is turned over, and then carries nine
 * controls where the same device upright carries four. `isShort` pulls it back:
 * one device, one bar.
 *
 * Stated once and read three times, because the unmute button and the devices
 * button have to agree with it — a landscape phone that lost the volume control
 * with `Actions` and did NOT gain the unmute button would be exactly the silent
 * dead end #326 closed.
 */
const phoneBar = computed(() => isMobile.value && (!isLargerMobile.value || isShort.value))

defineEmits<{
    (e: 'handleFav'): void
}>()
</script>

<style lang="scss">
.left-group {
    display: flex;
    // The bar's spacing token, like the transport row and the right group. It
    // stood at $medium (12px) here, which is the third of the three values the
    // bar carried.
    gap: $bar-gap;

    // Sized off the bar's own glyph token rather than a fresh number, and
    // pinned so the flexible track title cannot squeeze it.
    .bar-meter {
        flex-shrink: 0;
        width: $bar-glyph;
        height: $bar-glyph;
        color: $candy-text;
    }

    // The way out of silence, phone bar only (see the template). It is not a
    // volume control — it exists only while there is nothing to hear — so it
    // wears the same yellow "on" box as an active shuffle or repeat: a state
    // that is switched off with one tap, rather than a glyph to interpret.
    .bar-unmute {
        @include btn-quiet($size: $bar-control, $glyph: $bar-glyph);
        @include btn-toggle-on;
    }

    // (The devices button used to be patched here: a hand-written 44px box
    // plus `border: none; background-color: transparent` for the idle state.
    // That made it the one control in this row without a surface, next to a
    // prev/play/next that are all plated. It takes its own role in
    // DevicesButton.vue now — footprint included — so there is nothing left to
    // state at this call site.)
    align-items: center;
    font-size: small;
    font-weight: 700;
    line-height: 1.2;
    margin-right: $medium;

    // Favorite check next to the title (Spotify-style), desktop only.
    //
    // Nothing to state here any more: the box comes from `btn_role="bar"` at
    // the call site, so this control reads `$bar-control` like the transport
    // three centimetres to its right. What stood here was four `!important`
    // squaring it to 1.6rem plus a 1.3rem glyph override — and the comment
    // justifying them cited an `aspect-ratio: 1.5` the component had already
    // stopped having. Measured, the result was a 26px control in a row of 44px
    // ones.

    .np-image {
        position: relative;
        height: 3rem;

        // The cover is a fixed 3rem square, not a box that gives way. Without
        // this it does: the long title/artist line next to it wins the flex
        // fight, the box shrinks to a sliver while the 48px picture inside
        // keeps its size, `no-scroll` clips the overflow — and the 10px corner
        // radius on the visible strip turns the cover into a vertical pill.
        // Measured on the deployed client with a five-artist track: 16.9px at
        // 1024, 19.6px at 1280, correct again at 1440 only because there is
        // room to spare. It stood inside `@include largePhones`, so the phone
        // was pinned and every desktop width was not.
        flex-shrink: 0;

        // Lauflicht comet ring around the playing cover (always visible here).
        // The soft green bloom is suppressed in the compact bar — it would be
        // clipped by no-scroll (overflow:hidden) anyway; the bloom lives on the
        // bigger now-playing surfaces (sidebar card / full NP view).
        &.lauflicht-rim::after {
            display: none;
        }

        img {
            height: 100%;
            width: auto;
            aspect-ratio: 1;
            object-fit: cover;
            // Block-level so the inline baseline gap doesn't make .np-image
            // taller than the cover — that gap let the Lauflicht rim miss the
            // bottom edge instead of tracing all the way around.
            display: block;
            border: $candy-border;
            border-radius: $candy-radius-sm;
        }

        .expandicon {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(51, 51, 51, 0.6);

            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease-out, height 0.2s ease-out, transform 0.2s ease-out,
                background-color 0.2s ease-out;

            svg {
                transform: rotate(-90deg) scale(0.92);
            }
        }

        &:hover {
            .expandicon {
                transform: translateY(-$medium);
                height: 130%;
            }
        }

        &:active {
            .expandicon {
                background-color: rgba(51, 51, 51, 0.74);
            }
        }

        // (The phone-only `flex-shrink: 0` that used to stand here moved to the
        // top of this block: the squeeze is not a phone problem, it was only
        // ever REPORTED from a phone. The `margin-right` that stood here too —
        // $medium, dropping to $small on the narrowest phones — was the cover's
        // private half of a spacing rule the row now owns as a `gap`.)
    }

    // (The cover-replacement heart used to be squared to 3rem here, with a
    // `border: solid 1px $gray4` — a 1px ink line in a design whose border
    // width is 3px, and the only one in this bar. It reads `$bar-control` from
    // its role now, like everything else in the row.)

    .track-info {
        // Flex child: allow the title to truncate (ellipsis) and keep the
        // favorite heart hugging the title instead of being pushed to the
        // right edge near the transport controls.
        min-width: 0;
        max-width: 15rem;
        // `min-width: 0` above lets this box shrink, but shrinking is not
        // clipping: without this the title kept painting at its natural width
        // and ran UNDER the next control. That is what the unmute button
        // exposed — the box was 12px wide and the words were still there.
        overflow: hidden;

        .title {
            color: $candy-text;
            display: flex;
            align-items: center;
            margin-bottom: 2px;
            // A flex container's items refuse to shrink past min-content by
            // default, so the `.ellip` span inside never reached its own
            // ellipsis and pushed this row wider than its parent instead.
            min-width: 0;
        }

        .artistname {
            color: $candy-text-muted;

            a {
                font-size: 0.8rem;
            }
        }

        @include allPhones {
            width: calc(100% + 8px);
        }

        @include largePhones {
            width: unset;
            flex-grow: 1;
        }
    }

    @include allPhones {
        display: grid;
        // Cover, then the title takes the rest, then one max-content column per
        // control that happens to be there. The controls are conditional — the
        // unmute button only exists while the player is silent — so the trailing
        // columns are implicit; a fixed four-column template dropped the fifth
        // control onto a second row and doubled the bar's height.
        grid-auto-flow: column;
        grid-template-columns: max-content 1fr;
        grid-auto-columns: max-content;
        margin-right: unset;
    }

    @include largePhones {
        display: flex;
        // NOT 0, and this is what the plated devices button exposed: measured
        // at 390 and 360, `next` and `devices` sat at a gap of exactly 0 — two
        // 3px ink frames touching, reading as one welded 91px block.
        //
        // It was invisible for as long as the trailing controls were bare
        // glyphs: a 24px icon in a 44px box carries 10px of padding of its own,
        // so the row looked evenly spaced at any gap. Give them a fill and the
        // spacing has to be real. Same observation `_buttons.scss` records for
        // the desktop bar's 2px right-hand group, one breakpoint down.
        //
        // `$bar-gap-phone`, not the chrome's `$bar-gap` and not a bare $small:
        // the space genuinely is not there at 360px (the token carries the
        // arithmetic), and a third bar gap written into a breakpoint block is
        // exactly the unowned value the bar had three of before #387. The
        // cover's own `margin-right` is gone with this — it was this rule's
        // other half, written on one child.
        gap: $bar-gap-phone;
        max-width: calc(100% - 8px);
    }
}
</style>
