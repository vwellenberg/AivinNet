<template>
    <!-- 👇 login modal should not be dismissable -->
    <div v-if="modal.visible || modal.component == ModalOptions.login" class="modal">
        <div class="bg" @click="modal.hideModal"></div>
        <div
            v-motion-slide-top
            class="m-content rounded"
            :class="{
                settings: modal.component == modal.options.settings,
                authlogin: modal.component == modal.options.login,
            }"
            :style="{
                maxWidth: modal.component == modal.options.setRootDirs ? '56rem' : '30rem',
            }"
        >
            <!-- TODO: MOVE MAX WIDTH TO CLASS -->
            <div class="heading">{{ modal.title }}</div>
            <AuthLogin v-if="modal.component == modal.options.login" />
            <NewPlaylist
                v-if="modal.component == modal.options.newPlaylist"
                v-bind="modal.props"
                @hideModal="hideModal"
                @setTitle="setTitle"
            />
            <FolderModal
                v-if="modal.component == modal.options.folder"
                v-bind="modal.props"
                @hideModal="hideModal"
                @setTitle="setTitle"
            />
            <UpdatePlaylist
                v-if="modal.component == modal.options.updatePlaylist"
                v-bind="modal.props"
                @hideModal="hideModal"
                @setTitle="setTitle"
            />
            <EditTrack
                v-if="modal.component == modal.options.editTrackTags"
                v-bind="modal.props"
                @hideModal="hideModal"
                @setTitle="setTitle"
            />
            <FindCoverOnline
                v-if="modal.component == modal.options.findCoverOnline"
                v-bind="modal.props"
                @hideModal="hideModal"
                @setTitle="setTitle"
            />
            <div v-if="modal.component == modal.options.deletePlaylist">
                <ConfirmModal
                    :text="'Are you sure you want to permanently delete this playlist?'"
                    :cancel-action="modal.hideModal"
                    :confirm-action="deletePlaylist"
                />
            </div>
            <SetRootDirs v-if="modal.component == modal.options.setRootDirs" @hideModal="hideModal" />
            <RootDirsPrompt v-if="modal.component == modal.options.rootDirsPrompt" @hideModal="hideModal" />
            <Settings
                v-if="modal.component == modal.options.settings"
                @set-title="setTitle"
                @hideModal="hideModal"
            />
            <Devices v-if="modal.component == modal.options.devices" @setTitle="setTitle" />
        </div>
    </div>
</template>

<script setup lang="ts">
import { deletePlaylist as delPlaylist } from '@/requests/playlists'
import useModalStore, { ModalOptions } from '@/stores/modal'
import usePlaylistsStore from '@/stores/pages/playlists'
import { useRouter } from 'vue-router'
import { onMounted, onUnmounted, watch } from 'vue'

import AuthLogin from './modals/AuthLogin.vue'
import ConfirmModal from './modals/ConfirmModal.vue'
import Devices from './modals/Devices.vue'
import FolderModal from './modals/FolderModal.vue'
import NewPlaylist from './modals/NewPlaylist.vue'
import RootDirsPrompt from './modals/RootDirsPrompt.vue'
import EditTrack from './modals/EditTrack.vue'
import FindCoverOnline from './modals/FindCoverOnline.vue'
import SetRootDirs from './modals/SetRootDirs.vue'
import Settings from './modals/Settings.vue'
import UpdatePlaylist from './modals/updatePlaylist.vue'

const modal = useModalStore()
const router = useRouter()

// Mobile/desktop: the browser/hardware Back button should close an open modal
// (e.g. Settings) instead of navigating the app away. When a dismissable modal
// opens we push a throwaway history entry; a Back press pops it and the popstate
// handler closes the modal. When the modal is closed by other means (X /
// backdrop) we pop our own entry so history stays clean. `pushed` guards against
// double-pushes and feedback loops. The login modal is intentionally excluded —
// it must not be dismissable.
let pushed = false
const isBackDismissable = () => modal.visible && modal.component !== ModalOptions.login

watch(
    () => modal.visible && modal.component,
    () => {
        if (isBackDismissable() && !pushed) {
            history.pushState({ aivinnetModal: true }, '')
            pushed = true
        } else if (!modal.visible && pushed) {
            pushed = false
            if (history.state && history.state.aivinnetModal) history.back()
        }
    }
)

function onPopState() {
    if (modal.visible && modal.component !== ModalOptions.login) {
        // Back consumed our pushed entry; just close the modal (don't re-pop).
        pushed = false
        modal.hideModal()
    }
}

onMounted(() => window.addEventListener('popstate', onPopState))
onUnmounted(() => window.removeEventListener('popstate', onPopState))

function setTitle(title: string) {
    modal.setTitle(title)
}

function hideModal() {
    modal.hideModal()
}

function deletePlaylist() {
    const pid = modal.props.pid
    // Only navigate away if we're currently viewing the playlist being deleted
    // (e.g. deleting from its page). Deleting via the sidebar context menu
    // should not yank the user back somewhere.
    const route = router.currentRoute.value
    const onDeletedPage = route.name === 'PlaylistView' && Number(route.params.pid) === pid
    delPlaylist(pid)
        .then(() => usePlaylistsStore().removePlaylist(pid))
        .then(() => modal.hideModal())
        .then(() => {
            if (onDeletedPage) router.back()
        })
}
</script>

<style lang="scss">
.modal {
    position: fixed;
    // Above the bottom bar (.b-bar, z-index 50) so a blocking modal — and its
    // backdrop — cover it. Otherwise the bottom bar overlapped the modal on
    // mobile and hid the last rows of the settings list. Only the bottom bar
    // sits in the 21..60 range, so this re-orders nothing else.
    z-index: 60;
    // `dvh` after `vh`, the way `body` does it (Global/index.scss): on a phone
    // `100vh` is the viewport WITHOUT the browser's own chrome subtracted, so it
    // overshoots the visible area. That was survivable while the settings box
    // sized itself to its content; now that it takes a fixed share of this
    // element (see .m-content.settings), the overshoot would push its bottom
    // rows under the address bar, where they can be scrolled to but not seen.
    // The `vh` line stays as the fallback for engines without `dvh`.
    height: 100vh;
    height: 100dvh;
    width: 100vw;
    display: grid;
    place-items: center;

    input[type='search'] {
        margin: $small 0;
        border: $candy-border;
        border-radius: $candy-radius-sm;
        background-color: $candy-pink-soft;

        color: $candy-text;
        width: 100%;
        padding: $small $medium;
        font-size: 14px;
        outline: none;
        height: 2.75rem !important;
    }

    .bg {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        // opacity: 0;
        // visibility: hidden;
        background-color: rgb(0, 0, 0, 0.6);
        // transition: opacity 300ms ease, visibility 300ms ease;
        //background-color: rgba(22, 22, 22, 0.8);
        // backdrop-filter: blur(5px);
    }

    .m-content {
        width: calc(100% - 4rem);
        max-height: calc(100% - 4rem);
        padding: 2rem 1.25rem;
        position: relative;
        @include candy-box($candy-white, $candy-radius);
        @include candy-shadow(6px, 6px);
        color: $candy-text;

        @include allPhones {
            width: calc(100% - 2rem);
            max-height: calc(100% - 2rem);
            padding: 2rem 1rem;
        }
    }

    .m-content.settings {
        max-width: 50rem !important;
        padding: 0;
        overflow: hidden;

        // ONE height for every pane, not the content's. The modal is centred, so
        // a box that grows with its pane moves all four edges on every tab
        // switch — the nav list and the close button jump. See $settings-modal-h.
        // Still yields to a short window.
        height: min($settings-modal-h, calc(100% - 4rem));

        // Flex column so the settings panes get a height bounded by the modal
        // box itself and scroll internally, instead of relying on fragile
        // `100vh - Xrem` math that overshot the viewport.
        display: flex;
        flex-direction: column;

        @include allPhones {
            // Matches the tighter margin phones give every modal (above).
            height: min($settings-modal-h, calc(100% - 2rem));
        }
    }

    .m-content.authlogin {
        padding: 0;
    }
}
</style>
