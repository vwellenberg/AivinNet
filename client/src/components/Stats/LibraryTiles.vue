<template>
    <!-- What of the library the user has explored, how long it runs nonstop and
         what it is made of (#536). Not tied to the period: the library, and the
         user's plays since ever. -->
    <section v-if="library && library.files" class="library-tiles">
        <h3 class="section-title">Your library</h3>
        <div class="library-row">
            <StatItem
                :value="percentText(library.explored.tracks.share)"
                text="of your tracks heard"
                icon="library-explored"
                :detail="exploredDetail"
            />
            <StatItem
                :value="nonstopText(library.nonstop_seconds)"
                text="nonstop, the whole library"
                icon="library-nonstop"
                detail="every track of the library once, one after another"
            />
            <StatItem
                :value="topFormat"
                text="your top format"
                icon="library-formats"
                :detail="formatsText(library.formats)"
            />
            <StatItem
                :value="library.mean_bitrate ? `${library.mean_bitrate} kbps` : '—'"
                text="mean bitrate"
                icon="library-bitrate"
            />
            <StatItem
                :value="percentText(library.hires.share)"
                text="hi-res files"
                icon="library-hires"
                :detail="`${library.hires.files} of ${library.files} files above 48 kHz or 16 bit`"
            />
        </div>
    </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'

import StatItem from './StatItem.vue'
import { getLibraryStats, LibraryStatsPayload } from '@/requests/stats'
import { formatsText, nonstopText, percentText } from '@/utils/libraryStats'

const library = ref<LibraryStatsPayload | null>(null)

const topFormat = computed(() => {
    const top = library.value?.formats[0]
    return top ? `${top.format} ${percentText(top.share)}` : '—'
})

const exploredDetail = computed(() => {
    const explored = library.value?.explored
    if (!explored) return undefined
    return `${explored.tracks.heard} of ${explored.tracks.total} tracks · ${percentText(explored.albums.share)} of albums heard`
})

// Asked once: the library does not depend on the period. A late answer after
// the page is left must not be painted into the tiles of nothing.
let alive = true
onUnmounted(() => (alive = false))

onMounted(async () => {
    const res = await getLibraryStats()
    if (!alive) return
    library.value = res.status === 200 ? res.data : null
})
</script>

<style lang="scss">
.library-tiles {
    margin-top: 2rem;

    .section-title {
        @include mem-sticker;
        margin: 0 0 1rem 0;
        font-size: 1.15rem;
        font-weight: 700;
    }

    .library-row {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(13rem, 1fr));
        gap: 1rem;
    }

    .library-row .statitem {
        width: 100%;
        min-width: 0;
    }
}
</style>
