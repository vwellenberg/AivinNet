import { paths } from '@/config'
import { Track } from '@/interfaces'
import { NotifType, Notification } from '@/stores/notification'
import { pollJob, WRITE_TIMEOUT_MS } from './metadata'
import useAxios from './useAxios'

export interface EditTrackTagsPayload {
    title?: string
    album?: string
    artists?: string[]
    albumartists?: string[]
    track?: number
    /** Also name the file after the new tags ("03 - Title.mp3", #144). */
    rename_file?: boolean
    /**
     * Which file. Not a tag: a trackhash is shared by every file with the same
     * title/album/artists (`X.mp3` next to `X.wav`), and the server answers 409
     * instead of guessing when it names several.
     */
    filepath?: string
}

/** How the rename went, when one was asked for. The tags are written either way. */
interface RenameOutcome {
    name?: string
    unchanged?: boolean
    warning?: string
    error?: string
}

/** One message for both halves: a second notification would replace the first. */
function savedMessage(rename?: RenameOutcome): { text: string; type: NotifType } {
    if (!rename || rename.unchanged) return { text: 'Track tags updated', type: NotifType.Success }
    if (rename.error) {
        return { text: `Tags updated — the file kept its name: ${rename.error}`, type: NotifType.Info }
    }
    if (rename.warning) {
        return { text: `Tags updated, file renamed to ${rename.name} — the lyrics file kept the old name`, type: NotifType.Info }
    }
    return { text: `Tags updated, file renamed to ${rename.name}`, type: NotifType.Success }
}

/**
 * Writes edited metadata tags to a track's file on disk (admin only).
 *
 * PUT /track/<trackhash>/tags. The backend re-indexes the file, so the track's
 * trackhash may change; the re-indexed track is returned on success. Returns
 * null on any failure (a toast is shown).
 *
 * The write runs as a job on the server (#376): it backs the whole audio file
 * up first, and in the request that copy held every listener. The PUT answers
 * with a job id; the outcome comes from polling it.
 */
export async function editTrackTags(trackhash: string, tags: EditTrackTagsPayload): Promise<Track | null> {
    const { data, status } = await useAxios({
        url: paths.api.track + `/${trackhash}/tags`,
        method: 'PUT',
        props: tags,
    })

    if (status === 200 && data?.job) {
        const { result, error } = await pollJob<{ track: Track; rename?: RenameOutcome }>(data.job as string, {
            timeout: WRITE_TIMEOUT_MS,
            what: 'edit',
        })
        if (result?.track) {
            const { text, type } = savedMessage(result.rename)
            new Notification(text, type)
            return result.track
        }
        new Notification(error || 'Failed to update track tags', NotifType.Error)
        return null
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
