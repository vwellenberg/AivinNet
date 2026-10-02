<template>
    <div class="library-audit-modal">
        <p class="lead">
            Albums whose tags look broken. The list is worked out from the library as it is now, so it is current after
            every scan.
        </p>

        <div v-if="loading" class="state-box"><Spinner /></div>

        <p v-else-if="error" class="error">{{ error }}</p>

        <p v-else-if="!albums.length" class="state-box">
            Nothing to fix{{ ignored ? ` (${ignored} ignored)` : '' }} ✓
        </p>

        <ul v-else class="findings">
            <li v-for="album in albums" :key="album.key" class="finding rounded-sm">
                <div class="head">
                    <div class="title ellip">{{ album.title }}</div>
                    <div class="meta ellip">
                        {{ album.trackcount }} tracks · {{ shortFolder(album.folder) }}
                    </div>
                </div>
                <div class="reasons">
                    <span v-for="reason in album.reasons" :key="reason" class="reason rounded-sm">
                        {{ reasonLabel(reason, album) }}
                    </span>
                </div>
                <div class="actions">
                    <template v-if="album.reasons.includes('split')">
                        <select v-model="mergeArtist[album.key]" class="rounded-sm" :disabled="busy !== null">
                            <option v-for="name in album.merge_candidates" :key="name" :value="name">{{ name }}</option>
                        </select>
                        <button
                            type="button"
                            class="merge rounded-sm btn-pill"
                            :disabled="busy !== null"
                            @click="merge(album)"
                        >
                            {{ busy === album.key ? 'Merging…' : 'Merge into one album' }}
                        </button>
                    </template>
                    <button type="button" class="rounded-sm btn-pill" :disabled="busy !== null" @click="open(album)">
                        Open
                    </button>
                    <button type="button" class="rounded-sm btn-pill" :disabled="busy !== null" @click="ignore(album)">
                        Ignore
                    </button>
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { AuditAlbum, AuditReason, getAuditAlbums, ignoreAuditAlbum, mergeAuditAlbum } from '@/requests/metadata'
import useModal from '@/stores/modal'
import { Notification, NotifType } from '@/stores/notification'

import Spinner from '@/components/shared/Spinner.vue'

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Check library')

const router = useRouter()
const modal = useModal()

const albums = ref<AuditAlbum[]>([])
const ignored = ref(0)
const loading = ref(true)
const error = ref('')
/** The key of the finding being written, so the whole list waits for it. */
const busy = ref<string | null>(null)
const mergeArtist = ref<Record<string, string>>({})

async function load() {
    loading.value = true
    const data = await getAuditAlbums()
    loading.value = false

    if (!data) {
        error.value = 'Could not load the check.'
        return
    }

    albums.value = data.albums
    ignored.value = data.ignored
    for (const album of data.albums) {
        mergeArtist.value[album.key] ??= album.merge_candidates[0]
    }
}

const LABELS: Record<AuditReason, string> = {
    split: 'Split',
    number_artist: 'Track number as artist',
    placeholder_title: 'Placeholder titles',
    placeholder_artist: 'Placeholder artist',
    unknown_artist: 'No artist',
}

function reasonLabel(reason: AuditReason, album: AuditAlbum) {
    return reason === 'split' ? `Split into ${album.fragments} albums` : LABELS[reason]
}

function shortFolder(folder: string) {
    return folder.replace(/\/$/, '').split('/').slice(-2).join('/')
}

function open(album: AuditAlbum) {
    modal.hideModal()
    router.push({ name: 'AlbumView', params: { albumhash: album.albumhash } })
}

async function ignore(album: AuditAlbum) {
    busy.value = album.key
    const ok = await ignoreAuditAlbum(album.key)
    busy.value = null

    if (!ok) {
        new Notification('Could not ignore this album', NotifType.Error)
        return
    }
    albums.value = albums.value.filter(a => a.key !== album.key)
    ignored.value += 1
}

async function merge(album: AuditAlbum) {
    const artist = mergeArtist.value[album.key]
    if (!artist) return

    busy.value = album.key
    modal.setLocked(true)
    const { result, error: failure } = await mergeAuditAlbum(album.folder, album.title, artist)
    modal.setLocked(false)
    busy.value = null

    if (failure || !result) {
        new Notification(failure || 'The merge failed', NotifType.Error)
        return
    }
    if (result.failed.length) {
        new Notification(`${result.failed.length} of ${album.trackcount} files could not be written`, NotifType.Error)
    } else {
        new Notification(`"${album.title}" is one album now`, NotifType.Success)
    }
    await load()
}

onMounted(load)
</script>

<style lang="scss">
.library-audit-modal {
    display: grid;
    gap: $small;
    max-width: 40rem;

    .lead {
        margin: 0;
        color: $candy-text-muted;
        font-size: $medium;
    }

    .error {
        margin: 0;
        color: $red;
    }

    .state-box {
        display: grid;
        place-items: center;
        min-height: 6rem;
        margin: 0;
    }

    .findings {
        display: grid;
        gap: $small;
        max-height: 60vh;
        margin: 0;
        padding: 0;
        overflow-y: auto;
        list-style: none;
    }

    .finding {
        display: grid;
        gap: $smaller;
        padding: $small;
        @include candy-box($mem-panel, $candy-radius-sm);
    }

    .title {
        font-weight: 600;
    }

    .meta {
        color: $candy-text-muted;
        font-size: $medium;
    }

    .reasons {
        display: flex;
        flex-wrap: wrap;
        gap: $smaller;
    }

    .reason {
        padding: 0 $smaller;
        font-size: $medium;
        @include candy-box($mem-yellow, $candy-radius-sm);
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: $smaller;
        align-items: center;

        select {
            max-width: 14rem;
        }
    }
}
</style>
