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
            :description="item.description"
            :items="item.items"
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
        </PageItem>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'

import { playSources } from '@/enums'
import useHome from '@/stores/home'
import { maxAbumCards } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'

import Browse from '@/components/HomeView/Browse.vue'
import ContinueCard from '@/components/HomeView/ContinueCard.vue'
import ShuffleSvg from '@/assets/icons/shuffle.svg'
import { playFromAlbumCard } from '@/helpers/usePlayFrom'
import { getSurpriseAlbum } from '@/requests/home'
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
