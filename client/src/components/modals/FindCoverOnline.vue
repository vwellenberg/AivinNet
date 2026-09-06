<template>
    <div class="find-cover-modal">
        <form class="searchrow" @submit.prevent="runSearch">
            <input
                id="find-cover-query-input"
                v-model="searchQuery"
                type="search"
                class="rounded-sm"
                placeholder="Search for a cover"
                spellcheck="false"
            />
            <button type="submit" class="search-btn rounded-sm btn-pill" :disabled="loading">Search</button>
        </form>

        <div v-if="loading" class="state-box">
            <Spinner />
        </div>

        <div v-else-if="results && !results.length" class="state-box no-results">
            No results found — try renaming your search
        </div>

        <template v-else-if="current">
            <div class="preview rounded-sm">
                <img :src="current.url" :alt="current.album" @error="onImageError" />
            </div>
            <div class="meta">
                <div class="album ellip">{{ current.album }}</div>
                <div class="artist ellip">
                    {{ current.artist }} · {{ sourceLabel }} · {{ index + 1 }}/{{ resultCount }}
                </div>
            </div>
            <div class="buttons">
                <button type="button" class="shuffle-btn rounded-sm btn-pill" :disabled="saving" @click="shuffle">
                    Shuffle
                </button>
                <button type="button" class="use-btn rounded-sm btn-pill" :disabled="saving" @click="useImage">
                    {{ saving ? 'Saving…' : 'Use image' }}
                </button>
            </div>
        </template>
    </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, Ref } from 'vue'

import { CoverSuggestion, saveOnlineCoverForAlbum, saveOnlineCoverForPlaylist, searchCoversOnline, undoAlbumCover } from '@/requests/coverart'
import useAlbumStore from '@/stores/pages/album'
import usePStore from '@/stores/pages/playlist'
import { Notification, NotifType } from '@/stores/notification'

import Spinner from '@/components/shared/Spinner.vue'

const props = defineProps<{
    type: 'playlist' | 'album'
    id: number | string
    query: string
}>()

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Find cover online')

const searchQuery = ref(props.query)
// null = no completed search yet (initial state or the request failed);
// [] = a successful search with zero hits.
const results: Ref<CoverSuggestion[] | null> = ref(null)
const index = ref(0)
const loading = ref(false)
const saving = ref(false)

const current = computed(() => (results.value ? results.value[index.value] : undefined))
const resultCount = computed(() => (results.value ? results.value.length : 0))
const sourceLabel = computed(() => {
    switch (current.value?.source) {
        case 'itunes':
            return 'iTunes'
        case 'deezer':
            return 'Deezer'
        default:
            return current.value?.source || ''
    }
})

onMounted(() => runSearch())

async function runSearch() {
    const query = searchQuery.value.trim()

    if (!query || loading.value) return

    loading.value = true
    const res = await searchCoversOnline(query)
    results.value = res ? res.results : null
    index.value = 0
    loading.value = false

    // The server retries with shortened queries when the full one has no
    // hits — reflect the query that actually produced the results.
    if (res && res.results.length && res.query !== query) {
        searchQuery.value = res.query
    }
}

function shuffle() {
    if (!results.value || !results.value.length) return
    index.value = (index.value + 1) % results.value.length
}

// The suggestion image failed to load in the browser: drop it from the
// rotation instead of showing a broken preview. The failing entry is
// looked up by URL (the event may arrive after the user shuffled on).
function onImageError(e: Event) {
    if (!results.value) return

    const failed = (e.target as HTMLImageElement).src
    const i = results.value.findIndex(r => r.url === failed)

    if (i === -1) return
    results.value.splice(i, 1)

    if (index.value >= results.value.length) {
        index.value = 0
    }
}

async function useImage() {
    if (!current.value || saving.value) return

    saving.value = true
    const url = current.value.url

    if (props.type === 'playlist') {
        const ok = await saveOnlineCoverForPlaylist(props.id as number, url, usePStore())
        saving.value = false

        if (ok) emit('hideModal')
        return
    }

    const albumhash = props.id as string
    const filename = await saveOnlineCoverForAlbum(albumhash, url)
    saving.value = false

    if (!filename) return

    refreshAlbumView(albumhash)

    // Temporary toast with a one-level undo (the save snapshots the
    // previous cover files server-side).
    new Notification('Album cover updated', NotifType.Success, {
        label: 'Undo',
        handler: async () => {
            const ok = await undoAlbumCover(albumhash)
            if (!ok) return

            refreshAlbumView(albumhash)
            new Notification('Previous cover restored', NotifType.Success)
        },
    })

    emit('hideModal')
}

// If the album page currently shows this album, cache-bust its cover
// (same mechanism the MusicBrainz fetch uses) and refresh the page
// gradient colors. Other views pick the new cover up on their next fetch.
function refreshAlbumView(albumhash: string) {
    const albumStore = useAlbumStore()
    if (albumStore.info.albumhash === albumhash) {
        albumStore.bumpCoverVersion()
        albumStore.extractColors()
    }
}
</script>

<style lang="scss">
.find-cover-modal {
    display: grid;
    gap: $small;

    .searchrow {
        display: grid;
        grid-template-columns: 1fr max-content;
        gap: $small;
        align-items: center;

        input {
            margin: 0 !important;
        }

        .search-btn {
            height: 2.75rem;
            padding: 0 1.25rem;
            font-weight: 500;
        }
    }

    .state-box {
        display: grid;
        place-items: center;
        aspect-ratio: 1;
        width: 100%;
        @include candy-box($candy-pink-soft, $candy-radius-sm);
        color: $candy-text-muted;
        font-weight: 500;
        padding: 1rem;
        text-align: center;
    }

    .preview {
        aspect-ratio: 1;
        width: 100%;
        overflow: hidden;
        @include candy-box($candy-pink-soft, $candy-radius-sm);

        img {
            width: 100%;
            height: 100%;
            object-fit: cover;
            display: block;
        }
    }

    .meta {
        text-align: center;

        .album {
            font-weight: 600;
        }

        .artist {
            color: $gray1;
            font-size: small;
        }
    }

    .buttons {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: $small;
        margin-top: $smaller;

        button {
            height: 2.75rem;
            font-weight: 500;
        }

        .use-btn {
            &:disabled {
                opacity: 0.6;
            }
        }
    }
}
</style>
