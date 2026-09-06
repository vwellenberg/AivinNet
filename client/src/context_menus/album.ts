import useAlbum from '@/stores/pages/album'
import useTracklist from '@/stores/queue/tracklist'

import { getAlbumTracks } from '@/requests/album'
import { addAlbumToPlaylist } from '@/requests/playlists'
import { removeAlbumCover, uploadAlbumCover } from '@/requests/coverart'
import { NotifType, Notification } from '@/stores/notification'
import { toggleAlbumPin } from '@/helpers/pinAlbum'
import { downloadTracksIndividually } from '@/helpers/downloadTracks'
import usePinnedAlbums from '@/stores/pages/pinnedAlbums'

import { AddToQueueIcon, DeleteIcon, DownloadIcon, ImageIcon, PlayNextIcon, PlusIcon, PushPinIcon, SearchIcon } from '@/icons'
import { getBaseUrl, paths } from '@/config'
import { Album, Option, Playlist, Track } from '@/interfaces'
import useModal from '@/stores/modal'
import { loggedInUserIsAdmin } from '@/settings/utils'
import { get_find_on_social, getAddToPlaylistOptions } from './utils'

export default async (album?: Album) => {
    const albumStore = useAlbum()

    if (!album) {
        album = albumStore.info
    }

    // Named for the WHOLE album, and the track row's menu says plain "Play next"
    // for a single song. Both menus are one right-click apart on the album page:
    // with the same wording on both, "Play next" on the header dropped 25 rows
    // into the queue and read like a bug (reported 2026-08-15).
    const play_next = <Option>{
        label: 'Play album next',
        action: async () => {
            let tracks: Track[] = []

            if (album) {
                tracks = await getAlbumTracks(album.albumhash)
            } else {
                tracks = albumStore.tracks.filter(track => !track.is_album_disc_number)
            }

            useTracklist().insertAfterCurrent(tracks)
        },
        icon: PlayNextIcon,
    }

    const add_to_queue = <Option>{
        label: 'Add album to queue',
        action: async () => {
            let tracks: Track[] = []

            if (album) {
                tracks = await getAlbumTracks(album.albumhash)
            } else {
                tracks = albumStore.tracks.filter(track => !track.is_album_disc_number)
            }

            useTracklist().addTracks(tracks)
        },
        icon: AddToQueueIcon,
    }

    // Action for each playlist option
    const AddToPlaylistAction = (playlist: Playlist) => {
        addAlbumToPlaylist(playlist, album.albumhash)
    }

    const add_to_playlist: Option = {
        label: 'Add to Playlist',
        children: () =>
            getAddToPlaylistOptions(AddToPlaylistAction, {
                albumhash: album.albumhash,
                playlist_name: album.title,
            }),
        icon: PlusIcon,
    }

    const download_album = <Option>{
        label: 'Download as ZIP',
        action: () => {
            const a = document.createElement('a')
            a.href = getBaseUrl() + paths.api.download + `/album/${album.albumhash}`
            a.click()
        },
        icon: DownloadIcon,
    }

    // The ZIP is right on a desktop and wrong on a phone, where it lands in
    // Downloads, needs an unzip app, and leaves the files somewhere the music
    // player may never index. Individual files arrive playable — and since the
    // server names them from the tags, they stay identifiable lying loose.
    const download_tracks = <Option>{
        label: 'Download as files',
        action: async () => {
            const tracks = await getAlbumTracks((album as Album).albumhash)
            await downloadTracksIndividually(tracks, (album as Album).title || 'This album')
        },
        icon: DownloadIcon,
    }

    const find_cover_online = <Option>{
        label: 'Find cover online',
        action: () => {
            // The store fallback can briefly hold an empty album object.
            if (!album.albumhash) return

            const artist = album.albumartists && album.albumartists.length ? album.albumartists[0].name : ''

            useModal().showFindCoverOnlineModal({
                type: 'album',
                id: album.albumhash,
                query: `${album.title} ${artist}`.trim(),
            })
        },
        icon: SearchIcon,
    }

    // The online search only helps albums the internet knows about. Measured on
    // this library: of 478 albums without a cover, 11 could be found online and
    // 197 were skipped outright because their tags carry nothing a match could
    // be verified against. Those need a picture chosen by hand.
    const upload_cover = <Option>{
        label: 'Upload cover',
        action: () => {
            if (!album.albumhash) return

            // Built here rather than kept in the template: a context menu is
            // torn down as soon as it is dismissed, so a hidden <input> living
            // in some component would have to be reachable from every place
            // this menu opens.
            const picker = document.createElement('input')
            picker.type = 'file'
            picker.accept = 'image/*'

            picker.onchange = async () => {
                const file = picker.files?.[0]
                if (!file) return

                const image = await uploadAlbumCover(album.albumhash, file)
                if (image) {
                    new Notification('Cover updated', NotifType.Success)
                    // The <img> src carries a version query, so the browser
                    // would otherwise keep showing the cached old picture at
                    // an unchanged URL.
                    albumStore.bumpCoverVersion()
                }
            }

            picker.click()
        },
        icon: ImageIcon,
    }

    const remove_cover = <Option>{
        label: 'Remove cover',
        action: async () => {
            if (!album.albumhash) return

            if (await removeAlbumCover(album.albumhash)) {
                new Notification('Cover removed', NotifType.Success)
                albumStore.bumpCoverVersion()
            }
        },
        icon: DeleteIcon,
    }

    const is_pinned = usePinnedAlbums().isPinned(album.albumhash) || !!album.is_pinned
    const pin: Option = {
        label: is_pinned ? 'Unpin from library' : 'Pin to library',
        icon: PushPinIcon,
        action: () => toggleAlbumPin(album as Album),
    }

    const options = [play_next, add_to_queue, add_to_playlist, pin]

    // Cover changes rewrite the shared library — the picture every account sees,
    // and (with the embed setting on) the audio files themselves. The backend
    // rejects all three with 403 for a non-admin since AivinNet#105, so offering
    // them here would only produce an error toast.
    if (loggedInUserIsAdmin()) {
        options.push(find_cover_online, upload_cover, remove_cover)
    }

    options.push(download_album, download_tracks, get_find_on_social('album', '', album))

    return options
}
