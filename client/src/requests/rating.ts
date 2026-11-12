import { paths } from '@/config'
import { NotifType } from '@/enums'
import useAxios from './useAxios'

import { useToast as notif } from '@/stores/notification'

/**
 * Sets the current user's rating (1-5) of a track. Resolves to true on success.
 * A failure is reported to the user here; the caller rolls its own state back.
 */
export async function setTrackRating(trackhash: string, rating: number): Promise<boolean> {
    const { error } = await useAxios({
        url: paths.api.setRating,
        props: { trackhash, rating },
    })

    if (error) {
        notif().showNotification('Rating could not be saved', NotifType.Error)
        return false
    }

    return true
}

/** Removes the current user's rating of a track. Resolves to true on success. */
export async function clearTrackRating(trackhash: string): Promise<boolean> {
    const { error } = await useAxios({
        url: paths.api.clearRating,
        props: { trackhash },
    })

    if (error) {
        notif().showNotification('Rating could not be removed', NotifType.Error)
        return false
    }

    return true
}

/** Every track the current user has rated, as `trackhash -> rating`. */
export async function getAllTrackRatings(): Promise<Record<string, number>> {
    const { data, error } = await useAxios({
        url: paths.api.allRatings,
        method: 'GET',
    })

    if (error || !data) return {}

    return (data as { ratings: Record<string, number> }).ratings ?? {}
}

export interface RatingImportReport {
    imported: number
    skipped: number
    unreadable: number
}

const IMPORT_POLL_MS = 500
const IMPORT_TIMEOUT_MS = 15 * 60_000

/**
 * Reads every library file's rating into the current user's ratings (admin only).
 * Starts the job and polls it until the report is in.
 */
export async function importRatingsFromFiles(): Promise<{ report: RatingImportReport | null; error: string | null }> {
    const { data, status } = await useAxios({
        url: paths.api.importRatings,
        props: {},
    })

    const jobId = (data?.job as string) || null
    if (!jobId) {
        const reason = status === 409 ? 'An import is already running' : 'The import could not start'
        return { report: null, error: (data?.msg as string) || reason }
    }

    const deadline = Date.now() + IMPORT_TIMEOUT_MS
    while (Date.now() < deadline) {
        const { data: job, status: jobStatus } = await useAxios({
            url: `${paths.api.importRatings}/job/${jobId}`,
            method: 'GET',
        })

        if (jobStatus === 404) return { report: null, error: 'The import was lost' }

        if (jobStatus === 200 && job) {
            if (job.state === 'done') return { report: job.result as RatingImportReport, error: null }
            if (job.state === 'error') return { report: null, error: (job.error as string) || 'The import failed' }
        }

        await new Promise(resolve => setTimeout(resolve, IMPORT_POLL_MS))
    }

    return { report: null, error: 'The import took too long' }
}
