<template>
    <div class="homepageview content-page" :style="{ background: brandGradient() }">
        <GenericHeader>
            <template #name>Home</template>
        </GenericHeader>
        <Browse />
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
}

// Home is a wall of card grids, and every grid already fills its width
// (`auto-fill`, see CardScroller). The 1600/1680px column every other page is
// centred in (`$alt_layout_pad`, app-grid.scss) therefore only costs columns
// here: on a 2286px window it left ~250px of bare grid paper on each side and
// the rows stopped at 7 cards. Lists keep the narrow column — a track row
// stretched across 2000px reads worse, not better.
//
// Same shape as `$alt_layout_pad`, wider cap. The selector out-ranks the
// layout's own `.content-page` rule and its >=1980px twin (both 1,2,0).
$home-pad: max(2rem, calc((100% - #{$home-max-width}) / 2));

#app-grid.is_alt_layout .homepageview.content-page {
    padding-left: $home-pad;
    padding-right: $home-pad;
}
</style>
