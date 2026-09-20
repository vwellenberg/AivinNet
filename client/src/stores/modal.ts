import { defineStore } from 'pinia'

import { Track } from '@/interfaces'

export enum ModalOptions {
    newPlaylist,
    updatePlaylist,
    deletePlaylist,
    SetIP,
    rootDirsPrompt,
    setRootDirs,
    saveFolderAsPlaylist,
    login,
    settings,
    editTrackTags,
    folder,
    findCoverOnline,
    fetchMetadata,
    devices,
}

export default defineStore('newModal', {
    state: () => ({
        title: '',
        options: ModalOptions,
        component: <any>null,
        props: <any>{},
        visible: false,
        /** Set while the open modal is doing something that must not be abandoned. */
        locked: false,
    }),
    actions: {
        showModal(modalOption: ModalOptions, props: any = {}) {
            this.component = modalOption
            this.visible = true
            this.props = props
        },
        showNewPlaylistModal(props: any = {}) {
            this.showModal(ModalOptions.newPlaylist, props)
        },
        showFolderModal(props: any = {}) {
            this.showModal(ModalOptions.folder, props)
        },
        showSaveFolderAsPlaylistModal(path: string) {
            const playlist_name = path.split('/').pop()
            const props = {
                playlist_name,
                path,
            }
            this.showModal(ModalOptions.newPlaylist, props)
        },
        showSaveArtistAsPlaylistModal(name: string, artisthash: string) {
            const props = {
                artisthash,
                playlist_name: `This is ${name}`,
            }
            this.showModal(ModalOptions.newPlaylist, props)
        },
        showSaveQueueAsPlaylistModal(name: string) {
            const props = {
                is_queue: true,
                playlist_name: name,
            }
            this.showModal(ModalOptions.newPlaylist, props)
        },
        showEditPlaylistModal() {
            this.showModal(ModalOptions.updatePlaylist)
        },
        showDevicesModal() {
            this.showModal(ModalOptions.devices)
        },
        showEditTrackTagsModal(track: Track) {
            this.showModal(ModalOptions.editTrackTags, { track })
        },
        showFindCoverOnlineModal(props: { type: 'playlist' | 'album'; id: number | string; query: string }) {
            this.showModal(ModalOptions.findCoverOnline, props)
        },
        showFetchMetadataModal(props: { albumhash: string; albumTitle: string }) {
            this.showModal(ModalOptions.fetchMetadata, props)
        },
        showDeletePlaylistModal(pid: number) {
            const props = {
                pid: pid,
            }
            this.showModal(ModalOptions.deletePlaylist, props)
        },
        showSetIPModal() {
            this.showModal(ModalOptions.SetIP)
        },
        showRootDirsPromptModal() {
            this.showModal(ModalOptions.rootDirsPrompt)
        },
        showSetRootDirsModal() {
            this.showModal(ModalOptions.setRootDirs)
        },
        showLoginModal() {
            this.showModal(ModalOptions.login)
        },
        showSettingsModal() {
            this.showModal(ModalOptions.settings)
        },
        hideModal() {
            // A modal in the middle of writing to the library refuses to go. It
            // is the component that would report how many files succeeded and
            // refresh the page showing the old values; dismissed, the worker
            // carries on and the outcome reaches nobody.
            if (this.locked) return

            this.visible = false
            this.setTitle('')
        },
        setLocked(locked: boolean) {
            this.locked = locked
        },
        setTitle(new_title: string) {
            this.title = new_title
        },
    },
})
