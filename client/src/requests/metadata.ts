import useAxios from './useAxios'

// ---------------------------------------------------------------------------
// Fetching an album's track titles and numbers.
//
// Every endpoint here answers with a JOB ID rather than a result. That is not
// an API style choice: the server is single-threaded under bjoern, so a lookup
// that waited on musicbrainz.org would stop the whole app, `/` included. The
// work happens on a worker and we poll.
// ---------------------------------------------------------------------------

export type MetadataSource = 'musicbrainz' | 'filenames'

export interface ReleaseCandidate {
    mbid: string
    title: string
    artist: string
    date: string
    country: string
    format: string
    track_count: number
    score: number
}

export interface TrackSide {
    trackhash?: string
    filepath?: string
    title: string | null
    track: number | null
    disc: number | null
    duration: number
}

export interface PreviewRow {
    current: TrackSide | null
    proposed: TrackSide | null
    /** Seconds between the two durations; null when either side has none. */
    delta: number | null
    confident: boolean
}

export interface PreviewSummary {
    matched: number
    confident: number
    unmatched_local: number
    unmatched_remote: number
    ordered_by_filepath: boolean
}

export interface TrackChange {
    /**
     * ⚠️ The FILE, not the trackhash. A trackhash is derived from
     * title/album/artists, so an album whose files all say "Track 1" has
     * exactly one — and a batch addressed by hash would let the server pick
     * which file receives which title.
     */
    filepath: string
    title?: string
    track?: number
    disc?: number
}

interface Job<T> {
    state: 'running' | 'done' | 'error'
    result: T | null
    error: string | null
}

/** How long to wait for a worker before giving up on it. */
const POLL_TIMEOUT_MS = 30_000
const POLL_INTERVAL_MS = 400

async function start(url: string, props: object): Promise<{ job: string | null; error: string | null }> {
    const { data } = await useAxios({ url, props })
    return { job: (data?.job as string) || null, error: (data?.error as string) || null }
}

/**
 * Poll one job to completion.
 *
 * The deadline is not optional. `useAxios` resolves rather than rejects, so a
 * server that stopped answering looks exactly like a job that is still running
 * — without a ceiling the dialog would spin for ever with no way to tell the
 * two apart.
 */
export async function pollJob<T>(jobId: string): Promise<{ result: T | null; error: string | null }> {
    const deadline = Date.now() + POLL_TIMEOUT_MS

    while (Date.now() < deadline) {
        const { data, status } = await useAxios({ url: `/metadata/job/${jobId}`, method: 'GET' })

        if (status !== 200) {
            return { result: null, error: (data?.error as string) || 'The lookup was lost' }
        }

        const job = data as Job<T>
        if (job.state === 'done') return { result: job.result, error: null }
        if (job.state === 'error') return { result: null, error: job.error || 'The lookup failed' }

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))
    }

    return { result: null, error: 'The lookup took too long' }
}

async function run<T>(url: string, props: object): Promise<{ result: T | null; error: string | null }> {
    const { job, error } = await start(url, props)
    if (!job) return { result: null, error: error || 'Could not start the lookup' }
    return pollJob<T>(job)
}

export function fetchReleaseCandidates(albumhash: string) {
    return run<{ candidates: ReleaseCandidate[] }>('/metadata/album/candidates', { albumhash })
}

export function fetchPreview(albumhash: string, source: MetadataSource, mbid?: string) {
    return run<{ rows: PreviewRow[]; summary?: PreviewSummary; error?: string }>('/metadata/album/preview', {
        albumhash,
        source,
        mbid: mbid || null,
    })
}

export function applyChanges(changes: TrackChange[]) {
    return run<{ applied: { filepath: string; new_trackhash: string }[]; failed: { filepath: string; error: string }[] }>(
        '/metadata/album/apply',
        { changes }
    )
}
