<template>
    <!--
        Two elements on purpose, see the style block: the OUTER one carries the
        gap to the header above as padding, because the scroller measures this
        component's height and a margin would not be part of it.
    -->
    <div class="p-after-header" :class="{ 'with-date': showDateHeading, 'caps-list': caps_list }">
        <div class="ah-bar">
            <div class="ah-label">All Tracks</div>
            <div v-if="showDateHeading" class="date-added-heading">Date added</div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { isMedium, isSmall } from '@/stores/content-width'

const props = defineProps<{
    // Whether the track list below shows the "Date added" column (regular
    // playlists on wide layouts only), so the caption lines up with it.
    show_date_added?: boolean
    // Whether a track list actually follows. When it does, this row becomes the
    // ink cap on top of the list frame (see the style block); with no tracks
    // under it that cap would be a lid on an empty box, so it stays a plain
    // caption.
    caps_list?: boolean
}>()

const showDateHeading = computed(() => Boolean(props.show_date_added) && !isSmall.value && !isMedium.value)
</script>

<style lang="scss">
// ⚠️ THE GAP ABOVE IS PADDING, NOT MARGIN — and that is load-bearing.
//
// PlaylistView renders this through a `DynamicScroller`, which MEASURES each
// item and stacks the next one at `top + measured height`. A margin is not part
// of `getBoundingClientRect().height`, so the scroller reserved the bar's height
// while the margin pushed the bar further down: measured on the playlist page,
// the caption's bottom edge sat 12px past the first track row's top, i.e. the
// bar covered the top of the row it is supposed to cap. The old caption had the
// same 8px mismatch all along — invisible only because bare text has no edge to
// notice it by.
//
// So: the OUTER element is a transparent spacer whose padding counts towards the
// measured height, and `.ah-bar` is the caption itself. Anything with a fill
// belongs on `.ah-bar`; anything that is spacing belongs on the outer element.
.p-after-header {
    padding-top: $small;

    &.caps-list {
        padding-top: $medium;
    }
}

.p-after-header > .ah-bar {
    display: flex;
    align-items: center;
    height: 64px;
    padding: 0 1rem;

    font-size: 14px;
    font-weight: 700;

    // Both captions are stickers: this row sits on the memphis ground between
    // the header plate and the track list, and muted grey on the doodle tile is
    // the pairing the plates exist to avoid.
    .ah-label,
    .date-added-heading {
        @include mem-sticker(999px, 0.25rem 0.8rem);
        color: $candy-text-muted;
    }

    @media only screen and (max-width: 724px) {
        padding-left: 0.5rem;
    }
}

// Column-caption mode: same grid as .songlist-item.with-date (shared variable)
// so the "Date added" caption sits exactly above its column. The last (10rem)
// cell stays empty — it belongs to the duration column.
.p-after-header.with-date > .ah-bar {
    display: grid;
    grid-template-columns: $songlist-columns-with-date;
    gap: 1rem;
    padding: 0 0 0 $small;

    .ah-label {
        grid-column: 1 / 4;
    }

    .date-added-heading {
        font-size: small;
        white-space: nowrap;
    }
}

.isSmall .p-after-header > .ah-bar {
    padding-left: 0.5rem;
}

// ---------------------------------------------------------------------------
// THE INK CAP
//
// These captions used to stand bare on the doodled ground, where the grid lines
// run straight through the words — the one real legibility fault of the old
// list. Filled, they sit on a surface instead, and the bar doubles as the top of
// the list's frame: it rounds the two upper corners and closes the ink box the
// rows continue with their side stripes.
//
// These rules come LAST on purpose. They override height and padding set above
// — including the `.with-date` grid and the narrow-viewport media query — and at
// equal specificity source order decides. Same ordering trap the playlist header
// hit with its `shortViewport` block (.claude/rules/styling.md).
//
// ⚠️ The first row must NOT cap itself as well, or its rounded corner tucks in
// under this bar. PlaylistView drops `is_first` while this cap renders.
// ---------------------------------------------------------------------------
.p-after-header.caps-list > .ah-bar {
    height: 2.4rem;
    background-color: $mem-line;
    // Reads on the bar in both themes: ink bar on light, paper bar on dark
    // (`$mem-line` flips), and the ground flips with it.
    color: $mem-ground;
    border: $candy-border-w solid $mem-line;
    border-bottom: none;
    border-top-left-radius: $candy-radius-sm;
    border-top-right-radius: $candy-radius-sm;
    // Lines the captions up with the lead the rows keep clear for the guide
    // band. Stated once here for every viewport — the narrow-screen inset above
    // would otherwise pull them off it.
    padding: 0 $small 0 $songlist-lead;

    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.09em;
    text-transform: uppercase;

    // ⚠️ The captions are `mem-sticker`s above — plates with their own panel
    // fill, ink frame and offset shadow, because they used to sit bare on the
    // doodled ground. THIS bar is that surface now, so the stickers hand their
    // plate back: two nested plates would put a white pill on an ink bar and
    // shadow it against its own frame. The sticker stays where it belongs (the
    // caption on the ground); here the bar is the plate.
    .ah-label,
    .date-added-heading {
        padding: 0;
        background-color: transparent;
        border: none;
        box-shadow: none;
        color: inherit;
        font-size: inherit;
    }
}

.p-after-header.caps-list.with-date > .ah-bar {
    padding-left: $songlist-lead;
}

.isSmall .p-after-header.caps-list > .ah-bar {
    padding-left: $songlist-lead;
}
</style>
