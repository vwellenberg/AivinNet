import useTracklist from '@/stores/queue/tracklist'

import { getArtistTracks } from '@/requests/artists'
import { addArtistToPlaylist } from '@/requests/playlists'

import { AddToQueueIcon, PlayNextIcon, PlusIcon } from '@/icons'
import { Option, Playlist } from '@/interfaces'
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

    return [play_next, add_to_queue, add_to_playlist, get_find_on_social('artist')]
}
