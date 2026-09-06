<template>
    <RouterLink
        :to="{ name: Routes.playlist, params: { pid: pl.id } }"
        class="sidebar-playlist-item"
        :class="{ active: $route.params.pid == String(pl.id) }"
        draggable="true"
        @dragstart="onDragStart"
        @contextmenu.prevent="onContextMenu"
    >
        <div class="sidebar-pl-img rounded-sm">
            <img v-if="pl.has_image" :src="imgBase + pl.image" />
            <PlaylistImages v-else-if="pl.images && pl.images.length" :images="pl.images" size="small" />
            <div v-else class="sidebar-pl-placeholder">
                <PlaylistSvg />
            </div>
            <button
                class="pl-play-overlay"
                :class="{ playing: playing }"
                :title="playing ? 'Pause' : 'Play'"
                @click.prevent.stop="toggle"
            >
                <PauseSvg v-if="playing" />
                <PlaySvg v-else />
            </button>
        </div>
        <span class="ellip">{{ pl.name }}</span>
        <PushPinSvg v-if="pl.pinned" class="pl-pin" title="Pinned" />
    </RouterLink>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { paths } from '@/config'
import { Routes } from '@/router'
import { FromOptions } from '@/enums'
import { Playlist } from '@/interfaces'

import PlaylistSvg from '@/assets/icons/playlist-1.svg'
import PlaySvg from '@/assets/icons/play.svg'
import PauseSvg from '@/assets/icons/pause.svg'
import PushPinSvg from '@/assets/icons/push-pin.svg'

import PlaylistImages from '@/components/shared/PlaylistImages.vue'

import useQueue from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import { playFromPlaylist } from '@/helpers/usePlayFrom'
import { showPlaylistContextMenu } from '@/helpers/contextMenuHandler'

const props = defineProps<{ pl: Playlist }>()

const queue = useQueue()
const tracklist = useTracklist()
const ctxFlag = ref(false)

const imgBase = paths.images.playlist

const isCurrent = computed(
    () => (tracklist.from as any)?.type === FromOptions.playlist && (tracklist.from as any)?.id === props.pl.id
)
const playing = computed(() => isCurrent.value && queue.playing)

function toggle() {
    if (isCurrent.value) {
        queue.playPause()
    } else {
        playFromPlaylist(String(props.pl.id))
    }
}

function onDragStart(e: DragEvent) {
    e.dataTransfer?.setData('playlistid', String(props.pl.id))
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

// Wrapper so the handler receives the actual Ref — in the template,
// ctxFlag would be auto-unwrapped to a plain boolean.
function onContextMenu(e: MouseEvent) {
    showPlaylistContextMenu(e, props.pl, ctxFlag)
}
</script>
