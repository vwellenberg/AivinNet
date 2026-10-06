import { pollJob } from './metadata'
import useAxios from './useAxios'

export interface MusicBrainzStatus {
    in_progress: boolean
    total: number
    fetched: number
    failed: number
    started_at: number | null
    finished_at: number | null
}

// MusicBrainz is throttled to one search a second and the chain falls back to
// the stores, so a slow MusicBrainz takes up to about a minute.
const COVER_SEARCH_TIMEOUT_MS = 90_000

/**
 * Look for an album's cover online and save it.
 *
 * The server runs the search as a job and answers at once with its id; this
 * polls it. It used to search inside the request, and the server answers one
 * request at a time: everyone's playback waited for the search (AivinNet#295).
 */
export async function fetchCoverFromMusicBrainz(albumhash: string) {
    const { data, status } = await useAxios({
        url: '/musicbrainz/fetch-cover',
        props: { albumhash },
    })

    const job = data?.job as string | undefined
    if (!job) {
        return {
            success: false,
            image: null,
            error: (data?.error as string) || 'Could not start the cover search',
            status,
        }
    }

    const { result, error } = await pollJob<{ success: boolean; image?: string; error?: string }>(job, {
        timeout: COVER_SEARCH_TIMEOUT_MS,
        what: 'cover search',
    })

    return {
        success: !!result?.success,
        image: result?.image || null,
        error: error || result?.error || null,
        status,
    }
}

export async function fetchMissingCovers(limit = 0, retryFailed = false) {
    const { data, status } = await useAxios({
        url: '/musicbrainz/fetch-missing-covers',
        props: { limit, retry_failed: retryFailed },
    })

    return {
        success: !!data?.success,
        queued: (data?.queued as number) ?? 0,
        message: (data?.message as string) || null,
        error: (data?.error as string) || null,
        status, // 409 if a batch is already running
        runningStatus: (data?.status as MusicBrainzStatus) || null,
    }
}

export async function getMusicBrainzStatus(): Promise<MusicBrainzStatus | null> {
    const { data } = await useAxios({
        url: '/musicbrainz/status',
        method: 'GET',
    })

    return (data as MusicBrainzStatus) || null
}

export interface MissingCount {
    total: number
    missing: number
    failed: number
    remaining: number
}

export async function getMissingCoverCount(): Promise<MissingCount | null> {
    const { data } = await useAxios({
        url: '/musicbrainz/missing-count',
        method: 'GET',
    })

    return (data as MissingCount) || null
}
