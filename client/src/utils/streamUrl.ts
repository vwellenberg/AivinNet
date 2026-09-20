import { getBaseUrl, paths } from '@/config'

/**
 * The URL a track is played from.
 *
 * `/legacy` is not a fallback any more, it is the only streaming endpoint the
 * server has: the transcoding path was removed (#180, #181). With it went two
 * things this function used to carry:
 *
 *   - a `use_legacy` parameter that both callers passed a setting into, and
 *     that the first line overwrote with `true`;
 *   - `container` and `quality` query parameters, which the endpoint never
 *     read — its query model is `filepath` and nothing else.
 *
 * It lives here rather than in the player store because it is a pure function
 * and the store is not importable under test (it builds audio elements on
 * import), so every test mocked `getUrl` away — including the ones about
 * playback. The URL is the contract with the server; it deserves a test of its
 * own.
 */
export function getUrl(filepath: string, trackhash: string) {
    return `${getBaseUrl()}${paths.api.files}/${trackhash}/legacy?filepath=${encodeURIComponent(filepath)}`
}
