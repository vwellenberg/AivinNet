<template>
    <div class="library-audit-modal">
        <p class="lead">
            Albums whose tags look broken, checked again after every scan. Each one says what is wrong and how to fix
            it. Nothing in your files changes until you press Merge. Ignore hides an album until its tags change.
        </p>

        <div v-if="loading" class="state-box"><Spinner /></div>

        <p v-else-if="error" class="error">{{ error }}</p>

        <p v-else-if="!albums.length" class="state-box">
            Nothing to fix{{ ignored ? ` (${ignored} ignored)` : '' }} ✓
        </p>

        <ul v-else class="findings">
            <li v-for="(album, index) in albums" :key="album.key" class="finding rounded-sm">
                <div class="head">
                    <div class="title ellip">{{ album.title }}</div>
                    <div class="meta ellip">
                        {{ album.trackcount }} tracks · {{ shortFolder(album.folder) }}
                    </div>
                </div>
                <ul class="reasons">
                    <li v-for="reason in album.reasons" :key="reason" class="reason-row">
                        <span class="reason rounded-sm">{{ reasonLabel(reason, album) }}</span>
                        <span class="why">{{ reasonHelp(reason, album) }}</span>
                    </li>
                </ul>
                <div v-if="album.reasons.includes('split')" class="merge-row">
                    <label :for="`merge-${index}`">Album artist for all {{ album.trackcount }} tracks</label>
                    <select
                        :id="`merge-${index}`"
                        v-model="mergeArtist[album.key]"
                        class="rounded-sm"
                        :disabled="busy !== null"
                    >
                        <option v-for="name in album.merge_candidates" :key="name" :value="name">{{ name }}</option>
                    </select>
                    <button
                        type="button"
                        class="merge rounded-sm btn-pill"
                        :disabled="busy !== null"
                        @click="merge(album)"
                    >
                        {{ busy === album.key ? 'Merging…' : 'Merge' }}
                    </button>
                </div>
                <div class="actions">
                    <button type="button" class="rounded-sm btn-pill" :disabled="busy !== null" @click="open(album)">
                        Open album
                    </button>
                    <button
                        type="button"
                        class="rounded-sm btn-pill"
                        title="Hide it from this list until its tags change"
                        :disabled="busy !== null"
                        @click="ignore(album)"
                    >
                        Ignore
                    </button>
                </div>
            </li>
        </ul>
    </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { AuditAlbum, AuditReason, getAuditAlbums, ignoreAuditAlbum, mergeAuditAlbum } from '@/requests/metadata'
import useModal from '@/stores/modal'
import { Notification, NotifType } from '@/stores/notification'

import Spinner from '@/components/shared/Spinner.vue'

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Check library')

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

// What is wrong, in a sentence, and where it gets fixed. The badges alone named
// a symptom and left the reader guessing what the buttons do (reported so).
// The menu names are the labels of the album and track menus.
function reasonHelp(reason: AuditReason, album: AuditAlbum) {
    switch (reason) {
        case 'split':
            return `Its tracks name different album artists, so the library shows it as ${album.fragments} albums. Pick the album artist below and press Merge. Only that tag changes; playlists and favorites keep working.`
        case 'number_artist':
            return 'A track number was read as the artist (like "01"). Open the album and fix the artist with "Edit tags" in a track\'s menu.'
        case 'placeholder_title':
            return 'Some titles are placeholders like "Track 03". Open the album and use "Titles & file names" in its menu to fetch the real ones.'
        case 'placeholder_artist':
            return 'The artist is a placeholder like "Unknown Artist". Open the album and fix it with "Edit tags" in a track\'s menu.'
        case 'unknown_artist':
            return 'No track has an artist tag. Open the album and add one with "Edit tags" in a track\'s menu, or ignore it if the album really has none.'
    }
}

function shortFolder(folder: string) {
    return folder.replace(/\/$/, '').split('/').slice(-2).join('/')
}

// Through the store: closing pops a history entry, and a push of our own was
// cancelled by it ("Open" closed the dialog and stayed on the page).
function open(album: AuditAlbum) {
    modal.closeAndNavigate({ name: 'AlbumView', params: { albumhash: album.albumhash } })
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
        color: $candy-text;
        font-weight: 600;
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
        display: grid;
        gap: $smaller;
        margin: 0;
        padding: 0;
        list-style: none;
    }

    .reason-row {
        display: grid;
        gap: 2px;
        justify-items: start;
    }

    .reason {
        padding: 0 $smaller;
        font-size: $medium;
        @include candy-box($mem-yellow, $candy-radius-sm);
    }

    .why {
        font-size: $medium;
        line-height: 1.4;
    }

    .merge-row {
        display: flex;
        flex-wrap: wrap;
        gap: $smaller;
        align-items: center;

        label {
            flex-basis: 100%;
            font-size: $medium;
            font-weight: 600;
        }

        select {
            max-width: 14rem;
        }
    }

    .actions {
        display: flex;
        flex-wrap: wrap;
        gap: $smaller;
        align-items: center;
    }
}
</style>
