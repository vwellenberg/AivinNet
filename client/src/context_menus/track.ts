import { router } from '@/router'
import { Artist, Playlist, Track } from '@/interfaces'
import { router as Router, Routes } from '@/router'

import { Option } from '@/interfaces'
import { openInFiles } from '@/requests/folders'
import { addTracksToPlaylist, removeTracks } from '@/requests/playlists'

import { AddToQueueIcon, AlbumIcon, ArtistIcon, DeleteIcon, DownloadIcon, FolderIcon, PencilIcon, PlayNextIcon, PlusIcon, SearchIcon } from '@/icons'
import { getBaseUrl, paths } from '@/config'
import useModalStore from '@/stores/modal'
import usePlaylistStore from '@/stores/pages/playlist'
import useQueueStore from '@/stores/queue'
import useTracklist from '@/stores/queue/tracklist'
import { loggedInUserIsAdmin } from '@/settings/utils'
import { getAddToPlaylistOptions, get_find_on_social } from './utils'

/**
 * Returns a list of context menu items for a track.
 * @param  {any} track a track object.
 * @return {Array<Option>()} a list of context menu items.
 */

export default async (track: Track): Promise<Option[]> => {
    const route = router.currentRoute.value
    const on_playlist = route.name === Routes.playlist && !Number.isNaN(parseInt(route.params.pid as string))

    const track_artists = Object.values(
        [...track.artists, ...track.albumartists].reduce((acc, artist) => {
            acc[artist.artisthash] = artist
            return acc
        }, {} as Record<string, Artist>)
    )

    const goToArtist = async (artists: Artist[]) => {
        if (artists.length === 1) {
            return false
        }

        return artists.map(artist => {
            return <Option>{
                label: artist.name,
                action: () =>
                    Router.push({
                        name: Routes.artist,
                        params: {
                            hash: artist.artisthash,
                        },
                    }),
            }
        })
    }

    const AddToPlaylistAction = (playlist: Playlist) => {
        addTracksToPlaylist(playlist, [track]).then(success => {
            if (!(route.name == Routes.playlist && parseInt(route.params.pid as string) == playlist.id)) return

            if (!success) return
            const store = usePlaylistStore()
            store.addTrack(track)
            store.fetchAll(parseInt(route.params.pid as string), true)
        })
    }

    const add_to_playlist: Option = {
        label: 'Add to Playlist',
        children: () =>
            getAddToPlaylistOptions(AddToPlaylistAction, {
                trackhash: track.trackhash,
                playlist_name: track.title + ' Radio',
            }),
        icon: PlusIcon,
    }

    // The BARE labels belong to the single track: every container menu
    // (album/artist/folder/playlist) names its subject instead.
    const add_to_q: Option = {
        label: 'Add to queue',
        action: () => {
            useTracklist().addTrack(track)
        },
        icon: AddToQueueIcon,
    }

    const play_next: Option = {
        label: 'Play next',
        action: () => {
            useQueueStore().playTrackNext(track)
        },
        icon: PlayNextIcon,
    }

    const go_to_folder: Option = {
        label: 'Go to Folder',
        action: () => {
            Router.push({
                name: Routes.folder,
                params: { path: track.folder },
            })
        },
        icon: FolderIcon,
    }

    const go_to_artist: Option = {
        label: `Go to Artist`,
        icon: ArtistIcon,
        action: () => {
            track_artists.length == 1
                ? Router.push({
                      name: Routes.artist,
                      params: {
                          hash: track.artists[0].artisthash,
                      },
                  })
                : null
        },
        singleChild: track_artists.length === 1,
        children: () => goToArtist(track_artists),
    }

    const open_in_explorer: Option = {
        label: 'Open in files',
        action: () => {
            openInFiles(track.filepath || track.folder || '')
        },
        icon: FolderIcon,
    }

    const go_to_album: Option = {
        label: 'Go to Album',
        action: () => {
            Router.push({
                name: Routes.album,
                params: { albumhash: track.albumhash },
            })
        },
        icon: AlbumIcon,
    }

    // const del_track: Option = {
    //   label: "Delete Track",
    //   action: () => console.log("Delete Track"),
    //   icon: DeleteIcon,
    //   critical: true,
    // };

    const getRemoveFromPlaylistOption = () =>
        <Option>{
            label: 'Remove From Playlist',
            action: () => {
                removeTracks(parseInt(route.params.pid as string), [
                    { trackhash: track.trackhash, index: track.index },
                ]).then(() => {
                    const store = usePlaylistStore()
                    store.removeTrackByIndex(track.index)
                    store.fetchAll(parseInt(route.params.pid as string), true)
                })
            },
            icon: DeleteIcon,
            critical: true,
        }

    const download_track: Option = {
        label: 'Download',
        action: () => {
            const a = document.createElement('a')
            a.href = getBaseUrl() + paths.api.download + `/track/${track.trackhash}`
            a.click()
        },
        icon: DownloadIcon,
    }

    const edit_tags: Option = {
        label: 'Edit tags',
        action: () => useModalStore().showEditTrackTagsModal(track),
        icon: PencilIcon,
    }

    const find_cover_online: Option = {
        label: 'Find cover online',
        action: () => {
            if (!track.albumhash) return

            const artist = track.albumartists?.length ? track.albumartists[0].name : (track.artists[0]?.name ?? '')

            // Applies to the track's whole album; the confirm flow shows an
            // undo toast.
            useModalStore().showFindCoverOnlineModal({
                type: 'album',
                id: track.albumhash,
                query: `${track.album} ${artist}`.trim(),
            })
        },
        icon: SearchIcon,
    }

    const options: Option[] = [
        play_next,
        add_to_q,
        add_to_playlist,
        go_to_album,
        go_to_folder,
        go_to_artist,
        open_in_explorer,
        download_track,
        // Admin-only, and it keeps its place in the row: the cover search replaces
        // the album art every account sees, so the backend refuses it for a guest
        // (the 403 stands regardless of what is shown here).
        ...(loggedInUserIsAdmin() ? [find_cover_online] : []),
        get_find_on_social('track', `${track.title} ${track.artists[0].name}`),
        // del_track,
    ]

    // Editing tags rewrites files on disk and is admin-only on the backend, so
    // only surface it to admins (the backend still enforces 403 regardless).
    if (loggedInUserIsAdmin()) {
        options.push(edit_tags)
    }

    if (route.name === Routes.playlist && on_playlist) {
        options.splice(0, 0, getRemoveFromPlaylistOption())
    }

    if (route.name === Routes.nowPlaying) {
        options.splice(0, 0, <Option>{
            label: 'Remove from Queue',
            action: () => {
                useTracklist().removeByIndex(track.index)
            },
            icon: DeleteIcon,
            critical: true,
        })
    }

    return options
}

// TODO: Find a way to fetch playlists lazily. ie. When the "Add to playlist" option is triggered.
