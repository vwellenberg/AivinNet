<template>
    <form
        id="playlist-update-modal"
        class="playlist-modal"
        enctype="multipart/form-data"
        autocomplete="off"
        @submit.prevent="update_playlist"
    >
        <label for="name">Playlist name</label>
        <input
            id="modal-playlist-name-input"
            v-model="pname"
            type="search"
            class="rounded-sm"
            name="name"
            spellcheck="false"
            @keypress.enter.prevent="update_playlist"
        />

        <label for="image">Image</label>
        <!-- Deliberately no name attribute: with one, FormData(form) always
             includes an EMPTY file part named "image", which fails backend
             validation (422) on updates without a newly picked image. The
             submit handler appends the picked file manually. -->
        <input
            id="update-pl-image-upload"
            ref="dropZoneRef"
            type="file"
            accept="image/*"
            style="display: none"
            @change="handleUpload"
        />
        <div id="upload" class="boxed rounded-sm">
            <div class="clickable" tabindex="0" @click="selectFiles" @keydown.space.enter.stop="selectFiles">
                <ImageIcon />
                Click to {{ playlist.has_image ? 'update' : 'upload' }} cover image
            </div>
            <div
                id="update-pl-img-preview"
                class="image"
                :style="{
                    backgroundImage: `url(${playlist.image})`,
                }"
                tabindex="0"
            >
                <div v-if="!image && playlist.has_image" class="delete-icon" @click="pStore.removeBanner()">
                    <DeleteIcon />
                </div>
            </div>
        </div>
        <button type="button" class="find-cover-online rounded-sm btn-pill" @click="openFindCoverOnline">
            <SearchIcon />
            Find cover online
        </button>

        <!-- The banner switch and the position nudger are gone with the banner
             mode itself: the playlist header shows the image in a square media
             cell now, so there is no full-width photo left to square off or to
             pan up and down. -->

        <button type="submit" class="btn-pill">
            {{ clicked ? 'Saving' : 'Update' }}
        </button>
    </form>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { Ref, onMounted, ref } from 'vue'

import { updatePlaylist } from '@/requests/playlists'
import useModalStore from '@/stores/modal'
import usePStore from '@/stores/pages/playlist'

import DeleteIcon from '@/assets/icons/delete.svg'
import ImageIcon from '@/assets/icons/image.svg'
import SearchIcon from '@/assets/icons/search.svg'


const pStore = usePStore()
const { info: playlist } = storeToRefs(pStore)

const pname = ref(playlist.value.name)
const image: Ref<any> = ref(null)

// Settings snapshot: toggles (e.g. "Show square cover image") mutate the
// store in place, so changes are detected by comparing against this.
const origSettings = JSON.stringify(playlist.value.settings)

onMounted(() => {
    ;(document.getElementById('modal-playlist-name-input') as HTMLElement).focus()
})

const emit = defineEmits<{
    (e: 'setTitle', title: string): void
    (e: 'hideModal'): void
}>()

emit('setTitle', 'Update Playlist')

function openFindCoverOnline() {
    useModalStore().showFindCoverOnlineModal({
        type: 'playlist',
        id: playlist.value.id,
        query: playlist.value.name,
    })
}

function selectFiles() {
    const input = document.getElementById('update-pl-image-upload') as HTMLInputElement
    input.click()
}

function handleUpload() {
    const input = document.getElementById('update-pl-image-upload') as HTMLInputElement

    if (input.files) {
        handleFile(input.files[0])
    }
}

function handleFile(file: File) {
    if (!file || !file.type.startsWith('image/')) {
        return
    }

    const preview = document.getElementById('update-pl-img-preview')
    const obj_url = URL.createObjectURL(file)

    if (preview) {
        pStore.setImage(obj_url)
    }

    image.value = file
}

let clicked = ref(false)

function update_playlist(e: Event) {
    const form = document.getElementById('playlist-update-modal') as HTMLFormElement
    const formData = new FormData(form)

    const name = formData.get('name') as string

    const nameChanged = name !== playlist.value.name
    const imgChanged = image.value != null
    const settingsChanged = JSON.stringify(pStore.info.settings) !== origSettings

    if (!nameChanged && !imgChanged && !settingsChanged) {
        emit('hideModal')
        return
    }

    clicked.value = true

    // Only send the image when one was actually picked: appending null put
    // the literal string "null" into the form field, which failed backend
    // validation with a 422 — silently, so nothing ever saved.
    if (imgChanged) {
        formData.append('image', image.value)
    }
    formData.append('settings', JSON.stringify(pStore.info.settings))

    if (name && name.toString().trim() !== '') {
        updatePlaylist(playlist.value.id, formData, pStore).then(() => {
            emit('hideModal')
        })
    }
}

// Future TODO: Implement drag and drop for images here
</script>

<style lang="scss">
#playlist-update-modal {
    input {
        height: 3rem !important;
    }
}
.playlist-modal {
    #modal-playlist-name-input {
        margin-bottom: 1rem;
    }

    .boxed {
        border: $candy-border;
        color: $candy-text-muted;
        place-items: center;
        display: grid;
        grid-template-columns: 1fr max-content;
    }


    .find-cover-online {
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: $smaller;
        height: 2.75rem;
        margin-bottom: 1rem;

        svg {
            // search.svg has no width/height attributes (only a viewBox), so
            // without an explicit size it inflates to the button width.
            height: 1.25rem;
            width: 1.25rem;
            flex-shrink: 0;
        }
    }

    #upload {
        width: 100%;
        display: grid;
        gap: $small;
        border: none;
        margin: $small 0 1rem 0;

        svg {
            height: 2rem;
        }

        #update-pl-img-preview {
            width: 4.5rem;
            height: 4.5rem;
            border-radius: $small;
            object-fit: cover;
            background-color: $gray4;
            position: relative;
        }

        .clickable {
            font-weight: 500;
            height: 100%;
            width: 100%;
            display: flex;
            gap: $smaller;
            place-items: center;
            place-content: center;
            border-radius: $small;
            border: dashed 2px $mem-line;
            cursor: pointer;
            padding: $medium;

            svg {
                transform: scale(0.75);
                flex-shrink: 0;
            }
        }

        .delete-icon {
            position: absolute;
            width: 100%;
            height: 100%;
            background-color: $candy-text-faint;
            border-radius: $small;
            transition: all 0.2s ease-out;
            display: flex;
            place-content: center;
            place-items: center;
            cursor: pointer;

            svg {
                transform: scale(1);
                // White delete glyph over the image overlay — static light.
                color: $mem-panel-static;
                transition: transform 0.2s ease-out;
            }

            &:hover {
                background-color: $candy-pink-deep;

                svg {
                    transform: scale(1.25);
                    transform-origin: center;
                    color: $candy-black;
                }
            }
        }
    }

}
</style>
