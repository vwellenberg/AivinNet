<template>
    <RouterLink
        :to="{
            name: Routes.artist,
            params: {
                hash: artist.artisthash,
            },
        }"
        class="artist-card"
        @contextmenu.prevent="showContextMenu"
        :class="{ 'context-menu-open': contextMenuFlag }"
    >
        <CardTypeLabel type="artist" />
        <!-- `is-round`: the portrait is a disc, so the frame belongs to the
             image and the box stays open — the play disc sits in the square
             corner outside the circle and would otherwise be clipped. -->
        <div class="image card-art is-round">
            <img class="artist-image" :src="imguri + artist.image" />
            <PlayBtn :artisthash="artist.artisthash" :artistname="artist.name" :source="playSources.artist" />
        </div>
        <div class="card-plate">
            <div v-if="artist.help_text && !isTypeEcho(artist.help_text, 'artist')" class="rhelp t-center">
                <span class="help" :class="{ keep: !artist.time }">{{ artist.help_text }}</span>
                <span class="time">{{ artist.time }}</span>
            </div>
            <div class="artist-name t-center">
                {{ artist.name }}
            </div>
            <div v-if="artist.help_text && artist.trackcount" class="racount t-center">
                {{ artist.trackcount }} Track{{ artist.trackcount == 1 ? '' : 's' }}
            </div>
        </div>
    </RouterLink>
</template>

<script setup lang="ts">
import { paths } from '@/config'
import { Artist } from '@/interfaces'
import { Routes } from '@/router'

import { playSources } from '@/enums'
import CardTypeLabel from './CardTypeLabel.vue'
import PlayBtn from './PlayBtn.vue'
import { ref } from 'vue'
import { showArtistContextMenu } from '@/helpers/contextMenuHandler'
import { isTypeEcho } from '@/utils/cardTypes'

const imguri = paths.images.artist.medium
const contextMenuFlag = ref(false)

const props = defineProps<{
    artist: Artist
}>()

const showContextMenu = (e: MouseEvent) => {
    showArtistContextMenu(e, contextMenuFlag, props.artist.artisthash, props.artist.name)
}
</script>

<style lang="scss">
// Shape, frame, shadow and hover live in the shared anatomy
// (Global/cards.scss). Only what is specific to an artist tile stays here.
.artist-card {
    font-size: 0.95rem;
    font-weight: 700;

    .artist-image {
        // Match the square cover tiles' height behaviour: a fixed 1:1 box the
        // portrait is cropped into. `.card-art.is-round` supplies frame and
        // radius — this is the only tile whose motif is a disc.
        width: 100%;
        aspect-ratio: 1;
        object-fit: cover;
    }

    .artist-name {
        // Single line like every other card's name — wrapping would rock the
        // shared fixed text zone.
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: $candy-text;
        font-weight: 700;
    }

    .racount {
        font-size: 12px;
        color: $candy-text-muted;
    }
}
</style>
