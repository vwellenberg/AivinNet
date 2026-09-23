import useArtist from '@/stores/pages/artist'
import useTracklist from '@/stores/queue/tracklist'

import { getArtistTracks } from '@/requests/artists'
import { removeArtistImage, uploadArtistImage } from '@/requests/coverart'
import { addArtistToPlaylist } from '@/requests/playlists'
import { NotifType, Notification } from '@/stores/notification'

import { AddToQueueIcon, DeleteIcon, ImageIcon, PlayNextIcon, PlusIcon } from '@/icons'
import { Option, Playlist } from '@/interfaces'
import { loggedInUserIsAdmin } from '@/settings/utils'
import { getAddToPlaylistOptions, get_find_on_social } from './utils'

export default async (artisthash: string, artistname: string) => {
    // Every track by the artist, not the row that was right-clicked — the
    // artist page lists tracks too, and its rows carry their own "Play next".
    const play_next = <Option>{
        label: 'Play artist next',
        action: () => {
            getArtistTracks(artisthash).then(tracks => {
                const store = useTracklist()
                store.insertAfterCurrent(tracks)
            })
        },
        icon: PlayNextIcon,
    }

    const add_to_queue = <Option>{
        label: 'Add artist to queue',
        action: () => {
            getArtistTracks(artisthash).then(tracks => {
                const store = useTracklist()
                store.addTracks(tracks)
            })
        },
        icon: AddToQueueIcon,
    }

    // Action for each playlist option
    const AddToPlaylistAction = (playlist: Playlist) => {
        addArtistToPlaylist(playlist, artisthash)
    }

    const add_to_playlist: Option = {
        label: 'Add to Playlist',
        children: () =>
            getAddToPlaylistOptions(AddToPlaylistAction, {
                artisthash,
                playlist_name: `This is ${artistname}`,
            }),
        icon: PlusIcon,
    }

    // Only the artist PAGE can show the new picture right away — this menu also
    // opens from cards and search results, which pick it up on the next load
    // (the same gap the album cover actions have).
    const refreshPage = (color: string) => {
        const page = useArtist()
        if (page.info?.artisthash === artisthash) page.pictureChanged(color)
    }

    // Mostly for the artists no lookup can know: "Unknown", local bands,
    // anyone whose name Deezer matches to a stranger.
    const upload_picture = <Option>{
        label: 'Upload picture',
        action: () => {
            // Built here, not kept in a template: the menu is torn down as soon
            // as it closes (same reasoning as the album cover upload).
            const picker = document.createElement('input')
            picker.type = 'file'
            picker.accept = 'image/*'

            picker.onchange = async () => {
                const file = picker.files?.[0]
                if (!file) return

                const res = await uploadArtistImage(artisthash, file)
                if (res) {
                    new Notification('Picture updated', NotifType.Success)
                    refreshPage(res.color)
                }
            }

            picker.click()
        },
        icon: ImageIcon,
    }

    const remove_picture = <Option>{
        label: 'Remove picture',
        action: async () => {
            if (await removeArtistImage(artisthash)) {
                new Notification('Picture removed', NotifType.Success)
                refreshPage('')
            }
        },
        icon: DeleteIcon,
    }

    const options = [play_next, add_to_queue, add_to_playlist]

    // The picture is shared by every account; the server answers 403 to
    // anyone but an admin, so offering it to others would only raise an error.
    if (loggedInUserIsAdmin()) {
        options.push(upload_picture, remove_picture)
    }

    options.push(get_find_on_social('artist'))
    return options
}
