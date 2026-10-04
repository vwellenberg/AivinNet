<template>
    <div class="homepageview content-page" :style="{ background: brandGradient() }">
        <GenericHeader />
        <Browse class="browse-phones-only" />
        <PageItem
            v-for="item in home.homepageItems"
            :key="item.path"
            :title="item.title || ''"
            :description="item.description"
            :items="item.items"
            :play-source="playSources.track"
            :route="item.path"
            :see-all-text="item.seeAllText"
        />
    </div>
</template>

<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'

import { playSources } from '@/enums'
import useHome from '@/stores/home'
import { maxAbumCards } from '@/stores/content-width'
import updatePageTitle from '@/utils/updatePageTitle'

import Browse from '@/components/HomeView/Browse.vue'
import GenericHeader from '@/components/shared/GenericHeader.vue'
import PageItem from '@/components/shared/CardScroller.vue'
import { brandGradient } from '@/utils/colortools/pageGradient'

const home = useHome()

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
