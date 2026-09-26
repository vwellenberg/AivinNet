<template>
    <div v-if="album_disc.is_album_disc_number" class="album_disc_header no-select">
        <div class="disc_number">
            Disc {{ album_disc.album_page_disc_number }}
            <button
                type="button"
                class="play"
                @click="$emit('playDisc', album_disc.album_page_disc_number || 0)"
            >
                <PlaySvg /> Play Disc {{ album_disc.album_page_disc_number }}
            </button>
        </div>
        <div class="play"></div>
    </div>
</template>

<script setup lang="ts">
import PlaySvg from '@/assets/icons/play.svg'
import { AlbumDisc } from '@/interfaces'

defineProps<{
    album_disc: AlbumDisc
}>()

defineEmits<{
    (e: 'playDisc', disc_number: number): void
}>()
</script>

<style lang="scss">
.album_disc_header {
    display: grid;
    grid-template-columns: 1fr max-content;
    align-items: center;
    padding-left: 1rem;
    margin-top: $small;
    height: $song-item-height;

    // The disc divider ("Disc 1") is a caption on the memphis ground like the
    // section headings — sticker, and the muting comes from the muted text
    // token rather than `opacity` (which would fade the frame with the text).
    // The nested `.play` span/svg inherit this colour.
    .disc_number {
        @include mem-sticker($candy-radius-pill, 0.25rem 0.8rem);
        font-size: $medium;
        font-weight: 700;
        color: var(--look-sticker-text, #{$candy-text-muted});
        display: flex;
    }

    .play {
        // Restated for the <button> (#137).
        background-color: transparent;
        border: none;
        color: inherit;
        font: inherit;
        padding: 0;
        margin-left: $small;
        opacity: 0;
        cursor: pointer;
        display: flex;
        align-items: center;
        transition: opacity $motion-move ease-out;

        svg {
            height: 12px;
        }
    }

    @media only screen and (max-width: 724px) {
        padding-left: 0.5rem !important;
    }

    &:hover {
        .play {
            opacity: 1;
        }
    }

    // ⚠️ A control that is `opacity: 0` until hover becomes a TRAP once it is a
    // real button: the keyboard can focus it while nothing is drawn. It shows
    // itself on focus too (#137).
    .play:focus-visible {
        opacity: 1;
    }

    // Touch devices can't hover — keep "Play Disc" reachable (it's the only
    // way to start a single disc; whole-album play lives in the header).
    @media (hover: none) {
        .play {
            opacity: 1;
        }
    }
}
</style>
