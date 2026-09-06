import useAxios from './useAxios'

export interface MusicBrainzStatus {
    in_progress: boolean
    total: number
    fetched: number
    failed: number
    started_at: number | null
    finished_at: number | null
}

export async function fetchCoverFromMusicBrainz(albumhash: string) {
    const { data, status } = await useAxios({
        url: '/musicbrainz/fetch-cover',
        props: { albumhash },
    })

    return {
        success: !!data?.success,
        image: (data?.image as string) || null,
        error: (data?.error as string) || null,
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
