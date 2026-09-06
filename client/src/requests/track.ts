import { paths } from '@/config'
import { Track } from '@/interfaces'
import { NotifType, Notification } from '@/stores/notification'
import useAxios from './useAxios'

export interface EditTrackTagsPayload {
    title?: string
    album?: string
    artists?: string[]
    albumartists?: string[]
    track?: number
}

/**
 * Writes edited metadata tags to a track's file on disk (admin only).
 *
 * PUT /track/<trackhash>/tags. The backend re-indexes the file, so the track's
 * trackhash may change; the re-indexed track is returned on success. Returns
 * null on any failure (a toast is shown).
 */
export async function editTrackTags(trackhash: string, tags: EditTrackTagsPayload): Promise<Track | null> {
    const { data, status } = await useAxios({
        url: paths.api.track + `/${trackhash}/tags`,
        method: 'PUT',
        props: tags,
    })

    if (status === 200 && data?.track) {
        new Notification('Track tags updated', NotifType.Success)
        return data.track as Track
    }

    if (status === 401) {
        // useAxios already opens the login modal — don't stack a second toast.
        return null
    }

    if (status === 403) {
        new Notification('Only admins can edit track tags', NotifType.Error)
    } else if (status === 404) {
        new Notification('Track not found', NotifType.Error)
    } else {
        new Notification(data?.error || 'Failed to update track tags', NotifType.Error)
    }

    return null
}
