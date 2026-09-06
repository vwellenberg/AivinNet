<template>
    <div class="homepageview content-page" :style="{ background: brandGradient() }">
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
import { onMounted } from 'vue'

import { playSources } from '@/enums'
import useHome from '@/stores/home'
import updatePageTitle from '@/utils/updatePageTitle'

import Browse from '@/components/HomeView/Browse.vue'
import PageItem from '@/components/shared/CardScroller.vue'
import { brandGradient } from '@/utils/colortools/pageGradient'

const home = useHome()

onMounted(async () => {
    updatePageTitle('Home')
    await home.fetchAll()
})
</script>

<style lang="scss">
.homepageview {
    height: 100%;
    overflow: auto;

    .generichead {
        margin-bottom: 0;
    }
}
</style>
