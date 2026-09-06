<template>
    <div class="now-playing-top">
        <router-link class="now-playling-from-link" :to="(data.location as RouteLocationRaw)" title="Go to Play Source">
            <div class="from">
                <img
                    v-if="
                        tracklist.from.type === FromOptions.album ||
                        tracklist.from.type === FromOptions.artist
                    "
                    :src="data.image"
                    :class="`${tracklist.from.type === FromOptions.artist ? 'circular' : 'rounded-sm'}`"
                />
                <!-- With an empty queue playingFrom() has no glyph to show
                     (icon: ''), and this rendered as an empty blush box next to
                     "No source". -->
                <div v-else-if="data.icon" class="from-icon">
                    <component :is="data.icon"></component>
                </div>
                <div class="from-text">
                    <!-- The caption comes from playingFrom(), not from
                         `tracklist.from.type`: the raw enum printed
                         "PLAYLISTFOLDER" and repeated the line below it on the
                         two sources whose name is not an entity name. Guarded,
                         because an empty queue has no source to caption. -->
                    <div v-if="data.type" class="type">{{ data.type }}</div>
                    <div class="name">{{ data.name }}</div>
                </div>
            </div>
        </router-link>
        <button class="options" @click="showContextMenu">
            <MoreSvg />
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { RouteLocationRaw } from 'vue-router'

import useTracklist from '@/stores/queue/tracklist'

import { FromOptions } from '@/enums'
import playingFrom from '@/utils/playingFrom'

import MoreSvg from '@/assets/icons/more.svg'
import { showQueueContextMenu } from '@/helpers/contextMenuHandler'

const tracklist = useTracklist()

const context_showing = ref(false)

const data = computed(() => {
    const { type, name, location, icon, image } = playingFrom(tracklist.from)
    return { type, name, location, icon, image }
})

function showContextMenu(e: MouseEvent) {
    if (!tracklist.tracklist.length) return

    showQueueContextMenu(e, context_showing)
}
</script>

<style lang="scss">
.now-playing-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    // The plate and the button must not touch when the name is long; the
    // shrinking itself is the link's job (`min-width: 0` on it).
    gap: $small;
    margin-bottom: 1rem;

    // Overflow menu for the playing track — the same action role and size as
    // the overflow button in the album and artist headers.
    //
    // The dots are rotated on the GLYPH, not on the button: the button's
    // `transform` belongs to the role (scale on hover, press on active), and a
    // rotation there would be overwritten by the first of them.
    .options {
        @include btn-action($size: 2.75rem);

        svg {
            transform: rotate(90deg);
        }
    }
}

.now-playling-from-link {
    display: block;
    // `width: fit-content` used to sit here. It stops the link from ever being
    // narrower than its content, which is the opposite of what a plate with an
    // ellipsis needs.
    min-width: 0;
}

// The play source is a PLATE, not free-standing text.
//
// It used to be a 40px thumbnail beside two lines of type sitting straight on
// the memphis ground — and `$candy-text-muted` over the doodle tile is not a
// readable pairing: the "Playlist" label vanished into the confetti wherever a
// shape happened to sit behind it. Panel + frame + offset shadow is the answer
// this design already gives everywhere else (the time chips in
// `.below-progress` are the same move), and it makes the source read as one
// tappable object rather than an icon that happens to be near some words.
.now-playling-from-link > .from {
    display: flex;
    // `stretch`, not `center`: the media cell IS the plate's height, and its
    // dividing rule has to run the full way down.
    align-items: stretch;
    min-width: 0;
    background-color: $mem-panel;
    border: $candy-border;
    border-radius: $candy-radius-sm;
    box-shadow: 3px 3px 0 var(--mem-shadow);
    // The children are square-cornered; the plate does the rounding.
    overflow: hidden;

    // Media cell — the same 2.75rem the overflow button opposite it wears, so
    // the two ends of the row are siblings. It was 2.5rem with a 1px border
    // against that button's 3px, which is why they never looked related.
    img,
    .from-icon {
        width: $bar-control;
        height: $bar-control;
        flex-shrink: 0;
    }

    img {
        object-fit: cover;
    }

    // The artist thumbnail is a disc (`.circular`), so it gets a ground of its
    // own rather than floating against the bare panel.
    img.circular {
        padding: 2px;
        background-color: $candy-pink-soft;
    }

    // The dividing rule belongs to the TEXT side, not to the media cell. On the
    // artist source the thumbnail is fully rounded, and a `border-right` there
    // is drawn as an ARC following that radius, not as a straight rule. Stated
    // as an adjacent-sibling pair so an empty queue — which renders neither an
    // image nor a glyph (`icon: ''`) — does not get a rule against nothing.
    img + .from-text,
    .from-icon + .from-text {
        border-left: $candy-border;
    }

    .from-icon {
        display: flex;
        align-items: center;
        justify-content: center;
        background-color: $candy-pink-soft;

        svg {
            width: 1.5rem;
            height: 1.5rem;
            // Soft fill is theme-var (dark in dark) -> glyph must adapt too.
            color: $candy-text;
        }
    }

    .from-text {
        min-width: 0;
        padding: 0 $medium 0 0.625rem;
        display: flex;
        flex-direction: column;
        justify-content: center;
    }

    .type {
        text-transform: uppercase;
        font-size: 0.7rem;
        letter-spacing: 0.06em;
        color: $candy-text-muted;
        font-weight: 700;
        line-height: 1.2;
    }

    // One line, ellipsed. This was `.ellip2`, a two-line clamp — on a 2.75rem
    // plate the second line has nowhere to go.
    .name {
        font-weight: 700;
        font-size: 0.95rem;
        line-height: 1.25;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
}
</style>
