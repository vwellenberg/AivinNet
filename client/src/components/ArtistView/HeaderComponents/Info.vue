<template>
    <div class="artist-info dh-body">
        <section class="text">
            <div class="card-title dh-type">Artist</div>
            <div class="artist-name dh-title" :class="`${useCircularImage ? 'ellip' : 'ellip2'}`" :title="artist.name">
                {{ artist.name }}
            </div>
            <div class="stats dh-meta">
                <span v-if="artist.trackcount">
                    {{ artist.trackcount.toLocaleString() }} Track{{ `${artist.trackcount == 1 ? '' : 's'} • ` }}
                </span>
                <span v-if="artist.albumcount">
                    {{ artist.albumcount.toLocaleString() }} Album{{ `${artist.albumcount == 1 ? '' : 's'} • ` }}
                </span>
                <span v-if="artist.duration">
                    {{ `${formatSeconds(artist.duration, true)}` }}
                </span>
            </div>
        </section>
        <Buttons :use-circular-image="useCircularImage" />
    </div>
</template>

<script setup lang="ts">
import { Artist } from '@/interfaces'
import formatSeconds from '@/utils/useFormatSeconds'
import Buttons from './Buttons.vue'

defineProps<{
    artist: Artist
    useCircularImage?: boolean
}>()
</script>

<style lang="scss">
// Type, title and meta sizes come from `.dh-type` / `.dh-title` / `.dh-meta`
// in the shared anatomy (Global/detail-head.scss). The 3.5rem name was the
// fourth title size among four detail headers; it reads the shared token now.
.artist-info {
    .text {
        display: flex;
        flex-direction: column;
        gap: $smaller;
    }

    .artist-name {
        word-wrap: break-word;
    }
}
</style>