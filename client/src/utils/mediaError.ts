/**
 * Why an <audio> element reported `error`, in words a screenshot can carry.
 *
 * The player used to say only "Can't load: <title>" — for a missing file, a
 * dropped connection and a half-delivered stream alike — so a report like
 * "3 tracks in a row could not be loaded" could not be traced to a cause.
 * `MediaError.code` tells them apart (spec: MEDIA_ERR_ABORTED = 1, NETWORK = 2,
 * DECODE = 3, SRC_NOT_SUPPORTED = 4; the last one is also what a 404 gives).
 */
const REASONS: Record<number, string> = {
    1: 'aborted',
    2: 'network error',
    3: 'decode error',
    4: 'file not found or unsupported',
}

export interface MediaErrorInfo {
    code: number | null
    reason: string
    /** The element's source, readyState and networkState at the time of the error. */
    detail: string
}

export function describeMediaError(err: Event | string): MediaErrorInfo {
    if (typeof err === 'string') return { code: null, reason: err, detail: '' }

    const el = err.target as HTMLMediaElement | null
    const code = el?.error?.code ?? null
    const reason = (code !== null && REASONS[code]) || 'unknown error'
    const detail = el
        ? `src=${el.currentSrc || el.src || '(none)'} readyState=${el.readyState} networkState=${el.networkState}` +
          (el.error?.message ? ` message=${el.error.message}` : '')
        : ''

    return { code, reason, detail }
}
