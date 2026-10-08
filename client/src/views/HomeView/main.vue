<template>
    <div class="homepageview content-page" :style="{ background: brandGradient() }">
        <GenericHeader />
        <!-- Up to three unfinished albums/playlists, newest first. How many
             show depends on the width of THIS area (container query below):
             one on a laptop, two on a wide monitor, three on an ultrawide. -->
        <div v-if="home.continueListening.length" class="continue-row">
            <div class="continue-cards">
                <ContinueCard
                    v-for="entry in home.continueListening"
                    :key="entry.type + (entry.item?.albumhash ?? entry.item?.id)"
                    :entry="entry"
                />
            </div>
        </div>
        <Browse class="browse-phones-only" />
        <PageItem
            v-for="item in home.homepageItems"
            :key="item.key"
            :title="item.title || ''"
            :class="'home-row-' + item.key"
            :description="item.description"
            :items="rowItems(item)"
            :play-source="playSources.track"
            :route="item.path"
            :see-all-text="item.seeAllText"
        >
            <template v-if="item.key === 'rediscover'" #actions>
                <button class="btn-action surprise" :disabled="surprising" @click="surprise">
                    <ShuffleSvg />
                    Surprise me
                </button>
            </template>
            <!-- "Never played": one album of the row (or of the chip shown),
                 picked here — the row is already the server's best guess. -->
            <template v-else-if="item.key === 'never_played'" #actions>
                <button class="btn-action surprise" @click="playOne(rowItems(item))">
                    <ShuffleSvg />
                    Play one
                </button>
            </template>
            <!-- "On repeat" is also a playlist the server serves ("onrepeat"),
                 so the queue is named after it and keeps the row's order. -->
            <template v-else-if="item.key === 'on_repeat'" #actions>
                <button class="btn-action surprise" @click="playFromPlaylist('onrepeat')">
                    <PlaySvg />
                    Play all
                </button>
            </template>
            <template v-if="item.chips?.length" #chips>
                <div class="row-chips" role="group" aria-label="Filter by genre">
                    <button
                        class="row-chip"
                        :aria-pressed="!chipOf[item.key!]"
                        @click="chipOf[item.key!] = null"
                    >
                        Closest to you
                    </button>
                    <button
                        v-for="chip in item.chips"
                        :key="chip.key"
                        class="row-chip"
                        :aria-pressed="chipOf[item.key!] === chip.key"
                        @click="chipOf[item.key!] = chip.key"
                    >
                        {{ chip.label }}
                    </button>
                </div>
            </template>
        </PageItem>
    </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'

import { playSources } from '@/enums'
import useHome from '@/stores/home'
import { maxAbumCards } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'

import Browse from '@/components/HomeView/Browse.vue'
import ContinueCard from '@/components/HomeView/ContinueCard.vue'
import ShuffleSvg from '@/assets/icons/shuffle.svg'
import { playFromAlbumCard, playFromPlaylist } from '@/helpers/usePlayFrom'
import { getSurpriseAlbum } from '@/requests/home'
import { pickRowAlbum } from '@/utils/pickRowAlbum'
import { chipItems } from '@/utils/homeRows'
import { HomePageItem } from '@/interfaces'
import PlaySvg from '@/assets/icons/play.svg'
import GenericHeader from '@/components/shared/GenericHeader.vue'
import PageItem from '@/components/shared/CardScroller.vue'
import { brandGradient } from '@/utils/colortools/pageGradient'

const home = useHome()

// "Surprise me" on the Rediscover row: one random album from the whole
// library, played from the top. The server picks (RAM only).
const surprising = ref(false)
async function surprise() {
    surprising.value = true
    try {
        const albumhash = await getSurpriseAlbum()
        if (albumhash) await playFromAlbumCard(albumhash, '')
    } finally {
        surprising.value = false
    }
}

// The chip selected per row (by row key); none = the row's own items.
const chipOf = reactive<Record<string, string | null>>({})

function rowItems(item: HomePageItem) {
    return chipItems(item.items, item.chips, item.key ? (chipOf[item.key] ?? null) : null)
}

function playOne(items: Parameters<typeof pickRowAlbum>[0]) {
    const pick = pickRowAlbum(items)
    if (pick) playFromAlbumCard(pick.albumhash, pick.title)
}

onMounted(async () => {
    updatePageTitle('Home')
    await home.fetchAll()
})

// Dragging the window wider adds columns; the rows only fill them if we fetch
// more. Debounced so a drag is one request, not one per pixel.
watch(maxAbumCards, useDebounceFn(() => home.refetchIfWider(), 300))
</script>

<style lang="scss">
.homepageview {
    height: 100%;
    overflow: auto;

    .generichead {
        margin-bottom: 0;
    }

    // The cards share the row equally; extra ones only appear where there is
    // room for each to stay a proper card (~700px+). With fewer items than
    // room, the shown ones simply grow — no empty slot. Thresholds are the
    // content area's width, not the window's, so open sidebars count.
    .continue-row {
        container-type: inline-size;
        margin-bottom: 2rem;
    }

    .continue-cards {
        display: flex;
        gap: 1.5rem;

        > * {
            flex: 1 1 0;
            min-width: 0;
        }

        > :nth-child(n + 2) {
            display: none;
        }
    }

    @container (min-width: 1500px) {
        .continue-cards > :nth-child(2) {
            display: block;
        }
    }

    @container (min-width: 2250px) {
        .continue-cards > :nth-child(3) {
            display: block;
        }
    }

    // "Surprise me" sits in the Rediscover caption row, which is a flex row at
    // the caption's font size (1.15rem/700). Reset both, or the button inherits
    // a bold oversized label and the row squeezes it into two lines (measured
    // in the first branch build: "Surpri/se me").
    // `btn-action` is the square icon button (width = height); this one has a
    // label, so it takes its width from the content.
    .surprise {
        width: auto;
        padding: 0 0.9rem;
        flex-shrink: 0;
        white-space: nowrap;
        font-size: 0.85rem;
        font-weight: 700;
        gap: 0.4rem;

        svg {
            width: 1.1rem;
            height: 1.1rem;
        }
    }

    // Genre chips of "Never played", between its caption and the cards. The
    // pressed one wears the accent fill: the same yellow means "active" across
    // the app, and it reads in both themes.
    .row-chips {
        display: flex;
        flex-wrap: wrap;
        gap: $small;
        margin: -0.5rem 0 1.5rem;
    }

    .row-chip {
        min-height: 2.25rem;
        padding: 0 0.9rem;
        border-radius: $candy-radius-pill;
        border: $mem-ring-w solid $mem-frame;
        background-color: $mem-panel;
        color: $candy-text;
        font-size: 0.85rem;
        font-weight: 700;
        cursor: pointer;

        &[aria-pressed='true'] {
            background-color: $mem-yellow;
            border-color: $mem-ink;
            color: $mem-ink;
        }
    }

    // "Never played": a dashed frame and a "0 plays" tag on the artwork — the
    // album is in the library, but the user has not met it yet.
    .home-row-never_played .card-art {
        border-style: dashed;

        &::after {
            content: '0 plays';
            position: absolute;
            top: $small;
            left: $small;
            padding: 0 0.35rem;
            font-size: 0.7rem;
            font-weight: 700;
            color: $mem-ink;
            background-color: $mem-panel-static;
            border: $mem-hairline-w solid $mem-ink;
            border-radius: $candy-radius-xs;
        }
    }

    // Albums and Artists have their own entries in the left navigation, so the
    // block that links to them is only for phones, whose nav bar does not.
    // `display: none` takes its caption and padding with it: no gap, no stray
    // "Browse Library". Complement of the `allPhones` mixin (max-width: 900px).
    @media only screen and (min-width: 901px) {
        .browse-phones-only {
            display: none;
        }
    }
}
</style>
