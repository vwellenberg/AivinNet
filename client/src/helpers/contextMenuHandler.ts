import { Store } from 'pinia'
import { Ref } from 'vue'
import { useRoute } from 'vue-router'

import { ContextSrc } from '@/enums'
import { Album, Option, Playlist, Track } from '@/interfaces'
import useContextStore from '@/stores/context'

import albumContextItems from '@/context_menus/album'
import artistContextItems from '@/context_menus/artist'
import folderContextItems from '@/context_menus/folder'
import trackContextItems from '@/context_menus/track'
import queueContextItems from '@/context_menus/queue'
import playlistContextItems from '@/context_menus/playlist'
import { separator } from '@/context_menus/utils'

let stop_prev_watcher = () => {}

/** A row's own entries (`utils/cardMenu.ts`) go last, behind a separator. */
function withExtra(options: Option[], extra: Option[]): Option[] {
    return extra.length ? [...options, separator, ...extra] : options
}

function flagWatcher(menu: Store, flag: Ref<boolean>) {
    stop_prev_watcher()

    if (flag.value) {
        return (flag.value = false)
    }

    // watch for context menu visibility and reset flag
    stop_prev_watcher = menu.$subscribe((mutation, state) => {
        //@ts-ignore
        flag.value = state.visible
    })
}

export const showTrackContextMenu = (e: MouseEvent, track: Track, flag: Ref<boolean>) => {
    const menu = useContextStore()
    const options = () => trackContextItems(track)

    menu.showContextMenu(e, options, ContextSrc.Track)

    flagWatcher(menu, flag)
}

export const showAlbumContextMenu = (e: MouseEvent, flag: Ref<boolean>, album?: Album, extra: Option[] = []) => {
    const menu = useContextStore()

    const options = async () => withExtra(await albumContextItems(album), extra)
    menu.showContextMenu(e, options, ContextSrc.AlbumHeader)

    flagWatcher(menu, flag)
}

export const showFolderContextMenu = (e: MouseEvent, flag: Ref<boolean>, source: ContextSrc, path: string) => {
    const menu = useContextStore()

    const options = () => folderContextItems(path)
    menu.showContextMenu(e, options, source)

    flagWatcher(menu, flag)
}

export const showArtistContextMenu = (
    e: MouseEvent,
    flag: Ref<boolean>,
    artisthash: string,
    artistname: string,
    extra: Option[] = []
) => {
    const menu = useContextStore()

    const options = async () => withExtra(await artistContextItems(artisthash, artistname), extra)
    menu.showContextMenu(e, options, ContextSrc.ArtistHeader)

    flagWatcher(menu, flag)
}

export const showQueueContextMenu = (e: MouseEvent, flag: Ref<boolean>) => {
    const menu = useContextStore()

    const options = () => queueContextItems()
    menu.showContextMenu(e, options, ContextSrc.Queue)

    flagWatcher(menu, flag)
}

export const showPlaylistContextMenu = (
    e: MouseEvent,
    playlist: Playlist,
    flag: Ref<boolean>,
    // Opened from the playlist page's own header — see `playlistContextItems`.
    on_page = false
) => {
    const menu = useContextStore()

    const options = () => playlistContextItems(playlist, on_page)
    menu.showContextMenu(e, options, ContextSrc.PHeader)

    flagWatcher(menu, flag)
}

// export const showAlbumCardContextMenu = (e: MouseEvent, flag: Ref<boolean>, album: Album) => {

// }
