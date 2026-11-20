<template>
    <div class="itemsortby">
        <div class="tt select circular">Sort By</div>
        <div class="left group">
            <SortKey
                :items="($route.name == Routes.AlbumList ? albumitems : artistitems).concat(items)"
                :sortby="store.sortby"
                :reverse="store.reverse"
            />
        </div>
        <div class="right group">
            <div class="tt select circular"><ChartSvg /></div>
            <SortKey :items="statitems" :sortby="store.sortby" :reverse="store.reverse" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { Routes } from '@/router'
import { useRoute } from 'vue-router'

import { useAlbumList, useArtistList } from '@/stores/pages/itemlist'
import SortKey from './SortKey.vue'
import ChartSvg from '@/assets/icons/chart.svg'

const route = useRoute()
const store = route.name === Routes.AlbumList ? useAlbumList() : useArtistList()

const items = [
    { key: 'trackcount', displayName: 'No. of tracks' },
    { key: 'duration', displayName: 'Duration' },
    { key: 'created_date', displayName: 'Date added' },
    { key: 'lastplayed', displayName: 'Last played' },
]

const statitems = [
    { key: 'playcount', displayName: 'Plays' },
    { key: 'playduration', displayName: 'Play duration' },
]

const albumitems = [
    { key: 'title', displayName: 'Title' },
    { key: 'albumartists', displayName: 'Artist' },
    { key: 'date', displayName: 'Year released' },
]

const artistitems = [
    { key: 'name', displayName: 'Name' },
    { key: 'albumcount', displayName: 'No. of albums' },
]
</script>

<style lang="scss">
@import "./sortbanner-styles";


</style>
