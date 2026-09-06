<template>
    <RouterLink
        :to="{
            name: Routes.album,
            params: { albumhash: album.albumhash },
        }"
        class="album-card"
        @contextmenu.prevent="showMenu"
        :class="{ 'context-menu-open': contextMenuFlag }"
    >
        <CardTypeLabel type="album" />
        <div class="with-img card-art no-scroll">
            <img class="shadow-lg" :src="imguri + album.image" alt="" />
            <PlayBtn
                :store="useAlbumStore"
                :source="playSources.album"
                :album-hash="album.albumhash"
                :album-name="album.title"
            />
        </div>
        <div class="card-plate">
            <div v-if="album.help_text && !isTypeEcho(album.help_text, 'album')" class="rhelp album">
                <span class="help" :class="{ keep: !album.time }">{{ album.help_text }}</span>
                <span class="time">{{ album.time }}</span>
            </div>
            <h4 v-tooltip class="title ellip">
                {{ album.title }}
            </h4>
            <div class="artist ellip" @click.prevent.stop="() => {}">
                <template v-if="show_date"> {{ new Date(album.date * 1000).getFullYear() }} </template>
                <span v-if="show_date && artists.length > 0"> • </span>
                <RouterLink
                    v-if="artists.length > 0"
                    :to="{
                        name: Routes.artist,
                        params: { hash: artists[0].artisthash },
                    }"
                >
                    {{ `${artists[0].name}` }}
                </RouterLink>
            </div>
            <div v-if="album.versions.length" class="versions">
                <MasterFlag
                    v-for="v in getVersions(album.versions, useAlbumStore().info.versions)"
                    :key="v"
                    :bitrate="1200"
                    :text="v"
                />
            </div>
        </div>
    </RouterLink>
</template>

<script setup lang="ts">
import { Routes } from '@/router'
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'

import { Album } from '../../interfaces'
import CardTypeLabel from './CardTypeLabel.vue'
import PlayBtn from './PlayBtn.vue'

import { playSources } from '@/enums'
import useAlbumStore from '@/stores/pages/album'
import { paths } from '../../config'
import MasterFlag from './MasterFlag.vue'
import { showAlbumContextMenu } from '@/helpers/contextMenuHandler'
import { isTypeEcho } from '@/utils/cardTypes'

const route = useRoute()
const contextMenuFlag = ref(false)
const imguri = paths.images.thumb.medium

const props = defineProps<{
    album: Album
    show_date?: boolean
    artist_page?: boolean
    hide_artists?: boolean
}>()

function getVersions(ver1: string[], ver2: string[] = []) {
    const diff = ver1.filter(x => !ver2.includes(x))

    if (diff.length > 0) {
        return diff.slice(0, 1)
    }

    return ver1.slice(0, 1)
}

const artists = computed(() => {
    const albumartists = props.artist_page
        ? props.album.albumartists.filter(x => x.artisthash != route.params.hash)
        : props.album.albumartists

    return albumartists
})

function showMenu(e: MouseEvent) {
    showAlbumContextMenu(e, contextMenuFlag, props.album)
}
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss): `.card-art` for the picture, `.card-plate` for the text.
// Only what is specific to an album tile stays here.
.album-card {
    h4 {
        margin: 0;
    }

    .title {
        margin-bottom: $smallest;
        font-size: 0.95rem;
        width: fit-content;
        position: relative;
        color: $candy-text;
        font-weight: 700;
    }

    .artist {
        font-size: 0.8rem;
        text-align: left;
        color: $candy-text-muted;
        font-weight: 500;

        a {
            cursor: pointer !important;

            &:hover {
                text-decoration: underline;
            }
        }
    }

    .versions {
        display: flex;
        gap: $smaller;
        margin-top: $small;
        margin-left: -$smaller;
    }
}
</style>
