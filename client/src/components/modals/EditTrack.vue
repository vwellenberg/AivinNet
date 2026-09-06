<template>
    <form id="edit-track-modal" autocomplete="off" @submit.prevent="save">
        <label for="et-title">Title</label>
        <input id="et-title" v-model="title" type="text" class="et-input rounded-sm" spellcheck="false" />

        <label for="et-album">Album</label>
        <input id="et-album" v-model="album" type="text" class="et-input rounded-sm" spellcheck="false" />

        <label>Artists</label>
        <ChipInput v-model="artists" placeholder="Add an artist, press Enter" />

        <label>Album artists</label>
        <ChipInput v-model="albumartists" placeholder="Add an album artist, press Enter" />

        <label for="et-track">Track number</label>
        <input id="et-track" v-model.number="trackNo" type="number" min="0" class="et-input et-number rounded-sm" />

        <p class="et-warning">Saving writes these tags into the file on disk.</p>

        <button type="submit" class="btn-pill" :disabled="saving">{{ saving ? 'Saving…' : 'Save' }}</button>
    </form>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

import { Track } from '@/interfaces'
import { editTrackTags, EditTrackTagsPayload } from '@/requests/track'
import { NotifType, Notification } from '@/stores/notification'
import useTracklist from '@/stores/queue/tracklist'

import ChipInput from './ChipInput.vue'

const props = defineProps<{ track: Track }>()

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Edit tags')

const origArtists = (props.track.artists ?? []).map(a => a.name)
const origAlbumArtists = (props.track.albumartists ?? []).map(a => a.name)

const title = ref(props.track.title ?? '')
const album = ref(props.track.album ?? '')
const artists = ref<string[]>([...origArtists])
const albumartists = ref<string[]>([...origAlbumArtists])
const trackNo = ref<number | undefined>(props.track.track)

const saving = ref(false)

onMounted(() => {
    document.getElementById('et-title')?.focus()
})

function sameArray(a: string[], b: string[]) {
    return a.length === b.length && a.every((v, i) => v === b[i])
}

function save() {
    const t = title.value.trim()
    const al = album.value.trim()
    const ar = artists.value.map(a => a.trim()).filter(Boolean)
    const aa = albumartists.value.map(a => a.trim()).filter(Boolean)

    // Mirror the backend's required-non-empty fields so we don't round-trip to
    // a 400. Album is optional: clearing it removes the tag and the indexer
    // falls back to the filename.
    if (!t) {
        new Notification('Title is required', NotifType.Error)
        return
    }
    if (ar.length === 0) {
        new Notification('At least one artist is required', NotifType.Error)
        return
    }

    const payload: EditTrackTagsPayload = {}
    if (t !== props.track.title) payload.title = t
    if (al !== props.track.album) payload.album = al
    if (!sameArray(ar, origArtists)) payload.artists = ar
    if (!sameArray(aa, origAlbumArtists)) payload.albumartists = aa
    if (typeof trackNo.value === 'number' && !Number.isNaN(trackNo.value) && trackNo.value !== props.track.track) {
        payload.track = trackNo.value
    }

    if (Object.keys(payload).length === 0) {
        emit('hideModal')
        return
    }

    saving.value = true
    const oldHash = props.track.trackhash
    editTrackTags(oldHash, payload)
        .then(updated => {
            if (!updated) return
            // Patch the visible row in place: the context menu handed us the
            // store's reactive track object, so copying the re-indexed fields onto
            // it updates the row without a refetch. The backend re-serialises
            // is_favorite for the current user (the favorite is migrated to the
            // new trackhash), so the favorite indicator stays correct.
            Object.assign(props.track, updated)
            // Also patch any copies of this track in the play queue (it holds its
            // own objects). This keeps the now-playing bar and the current-row
            // highlight in sync — the queue's currenttrackhash is derived from the
            // track object, and currentindex is untouched, so playback is not
            // reloaded. A copy shown in a different, not-currently-mounted view
            // still refreshes on next navigation.
            useTracklist().retagTrack(oldHash, updated)
            emit('hideModal')
        })
        .finally(() => {
            saving.value = false
        })
}
</script>

<style lang="scss" scoped>
#edit-track-modal {
    display: flex;
    flex-direction: column;

    label {
        margin: $small 0 $smaller;
        font-weight: 500;
    }

    .et-input {
        border: $candy-border;
        background-color: $candy-pink-soft;
        color: $candy-text;
        width: 100%;
        padding: $small $medium;
        font-size: 14px;
        outline: none;
        height: 2.75rem;
    }

    .et-number {
        width: 8rem;
    }

    .et-warning {
        color: $gray1;
        font-size: 0.8rem;
        margin: 1rem 0;
    }

    button[type='submit'] {
        margin-top: $small;

        &:disabled {
            opacity: 0.6;
            cursor: default;
        }
    }
}
</style>
