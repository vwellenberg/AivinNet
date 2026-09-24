import { readFileSync } from 'node:fs'

import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// The client half of the client/server contract check.
//
// Every request function in src/requests/ is CALLED here, the request it would
// send is caught at axios, and that request is checked against the server's
// own contract: api-contract.json, derived from the OpenAPI spec of the real
// app and kept current by tests_api/test_api_contract.py. Both suites mock the
// other side, so without this a renamed field or a newly required one leaves
// both green while the app answers 422 — #36 shipped exactly that.
//
// What is checked, per request: the endpoint exists for that method; query
// and body fields are ones the server reads (anything else is silently
// dropped); required fields are present; json vs multipart matches; file
// fields are files. What is not: response shapes (the spec does not declare
// them) and behaviour below the spec (#39 — that is tests_api/'s job).
// ---------------------------------------------------------------------------

type Fields = { allowed: string[]; required: string[]; files?: string[] }
type Operation = { query?: Fields; body?: Fields & { type: 'json' | 'multipart'; optional?: boolean } }

// Read off disk, not imported: the file belongs to the server test, and a JSON
// import would put it through Vite's transform for no gain.
const CONTRACT: Record<string, Operation> = JSON.parse(
    readFileSync('src/requests/__tests__/api-contract.json', 'utf-8')
)

const { sent } = vi.hoisted(() => ({ sent: [] as any[] }))
vi.mock('axios', () => {
    const axios: any = vi.fn(async (config: any) => {
        sent.push(config)
        return { data: {}, status: 200 }
    })
    axios.defaults = {}
    for (const method of ['get', 'delete', 'head']) {
        axios[method] = (url: string, config: any = {}) => axios({ ...config, url, method })
    }
    for (const method of ['post', 'put', 'patch']) {
        axios[method] = (url: string, data: any, config: any = {}) => axios({ ...config, url, data, method })
    }
    axios.CancelToken = { source: () => ({ token: {}, cancel() {} }) }
    axios.isCancel = () => false
    return { default: axios }
})

// `**` on purpose: requests/plugins/ and requests/settings/ are modules too,
// and a flat glob left 15 of them unchecked without ever saying so.
const MODULES = import.meta.glob(['/src/requests/**/*.ts', '!/src/requests/**/__tests__/**'], {
    eager: true,
}) as Record<string, Record<string, unknown>>

/** 'album', 'plugins/index' — the path under src/requests/, without .ts. */
function moduleId(path: string): string {
    return path.replace('/src/requests/', '').replace(/\.ts$/, '')
}

const playlist = { id: 7, name: 'Mix', count: 3 } as any
const track = { trackhash: 't1', filepath: '/music/a.flac', title: 'A' } as any
const pStore = new Proxy({}, { get: () => () => {} })
const file = new File(['x'], 'cover.jpg', { type: 'image/jpeg' })
const form = (entries: Record<string, string | Blob>) => {
    const data = new FormData()
    for (const [key, value] of Object.entries(entries)) data.append(key, value)
    return data
}

/**
 * One realistic call per exported request function. A new export fails the
 * census below until it is added here — or to NOT_REQUESTS with a reason.
 */
const CALLS: Record<string, unknown[]> = {
    'album/getAlbum': ['alb1', 7],
    'album/getAlbumsFromArtist': [{ a1: 'Artist' }, 2, 'Title'],
    'album/getAlbumVersions': ['Title', 'alb1'],
    'album/getAlbumTracks': ['alb1'],
    'album/getSimilarAlbums': ['art1', 5],
    'album/pinUnpinAlbum': ['alb1'],
    'album/getPinnedAlbums': [],
    'album/reorderPinnedAlbums': [[{ albumhash: 'alb1', position: 0 }]],
    'artists/getArtistData': ['art1', 15, 7],
    'artists/getArtistSummary': ['art1'],
    'artists/getArtistAlbums': ['art1', 6, false],
    'artists/getArtistTracks': ['art1'],
    'artists/getSimilarArtists': ['art1', 6],
    'auth/getAllUsers': [true],
    'auth/loginUser': ['alice', 'secret'],
    'auth/logoutUser': [],
    'auth/getLoggedInUser': [],
    'auth/updateUserProfile': [{ id: 1, username: 'alice' }],
    'auth/uploadProfileImage': [form({ image: file })],
    'auth/removeProfileImage': [],
    'auth/addNewUser': [{ username: 'bob', password: 'secret' }],
    'auth/addGuestUser': [],
    'auth/deleteUser': ['bob'],
    'auth/sendPairRequest': [],
    'auth/pairWithCode': ['ABC123'],
    'colors/fetchAlbumColor': ['alb1'],
    'getall/getAllItems': ['albums', { start: 0, limit: 30, sortby: 'created_date', reverse: '1' }],
    'plugins/index/pluginSetActive': ['lyrics_finder', true],
    'plugins/index/updatePluginSettings': ['lyrics_finder', { auto_download: false }],
    'plugins/index/createLastfmSession': ['token-123'],
    'plugins/index/deleteLastfmSession': [],
    'plugins/lyrics/findLyrics': ['Blue', 'The Artist', '/music/a.flac', 'Blue Album', 't1'],
    'settings/index/getAllSettings': [],
    'settings/index/updateConfig': ['rootDirs', ['/music']],
    'settings/index/getBackups': [],
    'settings/index/restoreBackup': ['/backups/2026-09-01'],
    'settings/index/backupNow': [],
    'settings/index/deleteBackup': ['/backups/2026-09-01'],
    'settings/rootdirs/getRootDirs': [],
    'settings/rootdirs/addRootDirs': [['/music/new'], []],
    'settings/rootdirs/getFolders': ['$home'],
    'settings/rootdirs/triggerScan': [],
    'coverart/searchCoversOnline': ['blue album'],
    'coverart/saveOnlineCoverForPlaylist': [7, 'https://example.org/c.jpg', pStore],
    'coverart/saveOnlineCoverForAlbum': ['alb1', 'https://example.org/c.jpg'],
    'coverart/undoAlbumCover': ['alb1'],
    'coverart/removeAlbumCover': ['alb1'],
    'coverart/uploadAlbumCover': ['alb1', file],
    'devicesync/registerDevice': ['dev1', 'Laptop', 'desktop'],
    'devicesync/pollSession': [{ device_id: 'dev1', known_version: 0, client_sent_ms: 0, volume: 1, mute: false }],
    'devicesync/sendCommand': [{ device_id: 'dev1', type: 'play', payload: {} }],
    'devicesync/setQueue': [
        {
            device_id: 'dev1',
            trackhashes: ['t1'],
            from: { type: 'album', albumhash: 'alb1' },
            currentindex: 0,
            playing: true,
            position_ms: 0,
            repeat: 'none',
        },
    ],
    'devicesync/resolveTracks': [['t1']],
    'devicesync/joinGroup': ['dev1'],
    'devicesync/leaveGroup': ['dev1'],
    'favorite/addFavorite': ['track', 't1'],
    'favorite/removeFavorite': ['track', 't1'],
    'favorite/getAllFavs': [6, 6, 6],
    'favorite/getFavAlbums': [0, 6],
    'favorite/getFavTracks': [0, 5],
    'favorite/getFavArtists': [0, 6],
    'favorite/isFavorite': ['t1', 'track'],
    'folders/getFiles': ['/music'],
    'folders/openInFiles': ['/music/a.flac'],
    'folders/getTracksInPath': ['/music'],
    'home/getRecents': ['/nothome/recents/added', 9],
    'home/getRecentlyAdded': [9],
    'home/getRecentlyPlayed': [9],
    'home/getHomePageData': [9],
    'lyrics/getLyrics': ['/music/a.flac', 't1'],
    'lyrics/checkExists': ['/music/a.flac', 't1'],
    'metadata/pollJob': ['job1'],
    'metadata/fetchReleaseCandidates': ['alb1'],
    'metadata/fetchPreview': ['alb1', 'musicbrainz', 'mb1'],
    'metadata/applyChanges': [[{ filepath: '/music/a.flac', changes: { title: 'B' } }]],
    'musicbrainz/fetchCoverFromMusicBrainz': ['alb1'],
    'musicbrainz/fetchMissingCovers': [0, false],
    'musicbrainz/getMusicBrainzStatus': [],
    'musicbrainz/getMissingCoverCount': [],
    'playlistFolders/getPlaylistFolders': [],
    'playlistFolders/createPlaylistFolder': ['Folder'],
    'playlistFolders/renamePlaylistFolder': [3, 'Folder 2'],
    'playlistFolders/deletePlaylistFolder': [3],
    'playlistFolders/movePlaylistToFolder': [7, 3, 0],
    'playlistFolders/reorderPlaylistFolders': [[{ id: 3, position: 0 }]],
    'playlists/reorderSidebarPlaylists': [[{ id: 7, position: 0 }]],
    'playlists/createNewPlaylist': ['Mix'],
    'playlists/getAllPlaylists': [false],
    'playlists/getPlaylist': [7, false, 0, 50],
    'playlists/addItemToPlaylist': [playlist, { itemtype: 'tracks', itemhash: 't1' }],
    'playlists/addTracksToPlaylist': [playlist, [track]],
    'playlists/addAlbumToPlaylist': [playlist, 'alb1'],
    'playlists/addFolderToPlaylist': [playlist, '/music'],
    'playlists/addArtistToPlaylist': [playlist, 'art1'],
    'playlists/saveItemAsPlaylist': ['tracks', { playlist_name: 'Mix', itemhash: 't1' }],
    'playlists/saveTrackAsPlaylist': ['Mix', 't1'],
    'playlists/saveAlbumAsPlaylist': ['Mix', 'alb1'],
    'playlists/saveFolderAsPlaylist': ['Mix', '/music'],
    'playlists/saveArtistAsPlaylist': ['Mix', 'art1'],
    'playlists/updatePlaylist': [7, form({ name: 'Mix', settings: '{}', image: file }), pStore],
    'playlists/deletePlaylist': [7],
    'playlists/removeTracks': [7, [{ trackhash: 't1', index: 0 }]],
    'playlists/removeBannerImage': [7],
    'playlists/movePlaylistTrack': [7, 't1', 't2'],
    'playlists/pinUnpinPlaylist': [7],
    'searchMusic/searchTopResults': ['blue', 5],
    'searchMusic/searchTracks': ['blue', 0],
    'searchMusic/searchAlbums': ['blue', 0],
    'searchMusic/searchArtists': ['blue', 0],
    'searchMusic/searchFolders': ['blue', 0],
    'stats/getChartItem': ['tracks', 'week', 10, 'playduration', 0],
    'stats/getTopArtists': ['week', 10, 'playduration'],
    'stats/getTopAlbums': ['week', 10, 'playduration'],
    'stats/getTopTracks': ['week', 10, 'playduration'],
    'stats/getStats': [],
    'track/editTrackTags': ['t1', { title: 'B' }],
}

/** Exported functions that send nothing themselves. */
const NOT_REQUESTS: Record<string, string> = {
    'useAxios/default': 'the transport itself — every call above goes through it',
}

function exportedFunctions(): string[] {
    const names: string[] = []
    for (const [path, module] of Object.entries(MODULES)) {
        for (const [name, value] of Object.entries(module)) {
            if (typeof value === 'function') names.push(`${moduleId(path)}/${name}`)
        }
    }
    return names.sort()
}

/** Resolve a URL to its contract entry: exact paths win over templated ones. */
function findOperation(method: string, path: string): [string, Operation] | undefined {
    const exact = `${method} ${path}`
    if (CONTRACT[exact]) return [exact, CONTRACT[exact]]
    for (const [key, op] of Object.entries(CONTRACT)) {
        const [opMethod, template] = key.split(' ')
        if (opMethod !== method || !template.includes('{')) continue
        const pattern = new RegExp('^' + template.replace(/\{[^}]+\}/g, '[^/]+') + '$')
        if (pattern.test(path)) return [key, op]
    }
}

/** FormData field names, once each. (`FormData.keys()` is not in this project's TS lib.) */
function formKeys(data: FormData): string[] {
    const keys = new Set<string>()
    data.forEach((_, key) => keys.add(key))
    return [...keys]
}

function checkFields(where: string, sentKeys: string[], fields: Fields | undefined): string[] {
    const problems: string[] = []
    const allowed = fields?.allowed ?? []
    for (const key of sentKeys) {
        if (!allowed.includes(key)) problems.push(`${where} field "${key}" is not read by the server`)
    }
    for (const key of fields?.required ?? []) {
        if (!sentKeys.includes(key)) problems.push(`required ${where} field "${key}" is missing`)
    }
    return problems
}

/** Everything wrong with one captured request, as readable sentences. */
function violations(request: any): { endpoint: string; problems: string[] } {
    const method = String(request.method || 'GET').toUpperCase()
    const url = new URL(request.url, 'http://server')
    const path = url.pathname
    const endpoint = `${method} ${path}`

    const match = findOperation(method, path)
    if (!match) return { endpoint, problems: ['no such endpoint on the server'] }
    const [, op] = match

    const queryKeys = [...new Set([...url.searchParams.keys(), ...Object.keys(request.params ?? {})])]
    const problems = checkFields('query', queryKeys, op.query)

    const data = request.data
    const hasData = data !== undefined && data !== null
    if (!op.body) {
        if (hasData) {
            const keys = data instanceof FormData ? formKeys(data) : Object.keys(data)
            if (keys.length) problems.push(`sends a body (${keys.join(', ')}) the endpoint does not read`)
        }
        return { endpoint, problems }
    }

    if (!hasData) {
        if (!op.body.optional) problems.push('sends no body; the endpoint requires one')
        return { endpoint, problems }
    }

    if (op.body.type === 'multipart') {
        if (!(data instanceof FormData)) return { endpoint, problems: [...problems, 'body must be multipart FormData'] }
        problems.push(...checkFields('body', formKeys(data), op.body))
        for (const name of op.body.files ?? []) {
            const value = data.get(name)
            if (value !== null && !(value instanceof Blob)) problems.push(`file field "${name}" is not a file`)
        }
    } else {
        if (data instanceof FormData) return { endpoint, problems: [...problems, 'body must be JSON, not FormData'] }
        // JSON.stringify drops undefined, so an undefined field never arrives.
        const keys = Object.keys(data).filter(key => data[key] !== undefined)
        problems.push(...checkFields('body', keys, op.body))
    }
    return { endpoint, problems }
}

beforeEach(() => {
    setActivePinia(createPinia())
    vi.useFakeTimers() // pollers and toasts must not outlive the call
    sent.length = 0
})

afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
})

/** Call a request function and collect what it sent, without waiting for it to finish. */
async function capture(id: string): Promise<any[]> {
    const cut = id.lastIndexOf('/')
    const fn = MODULES[`/src/requests/${id.slice(0, cut)}.ts`][id.slice(cut + 1)] as (...args: unknown[]) => unknown
    // The stub answers `{}`, so a caller that then reads `data.items` throws —
    // irrelevant here, the request was already sent. Not awaited: a poller
    // would never finish under fake timers.
    try {
        Promise.resolve(fn(...CALLS[id])).catch(() => {})
    } catch {
        // thrown synchronously, same reasoning
    }
    for (let i = 0; i < 20; i++) await Promise.resolve()
    return [...sent]
}

describe('client requests match the server contract', () => {
    it('every exported request function is exercised (census)', () => {
        const exported = exportedFunctions()
        const unlisted = exported.filter(id => !(id in CALLS) && !(id in NOT_REQUESTS))
        const stale = Object.keys(CALLS).filter(id => !exported.includes(id))

        expect(unlisted, 'add a realistic call to CALLS').toEqual([])
        expect(stale, 'these no longer exist — remove them from CALLS').toEqual([])
    })

    it.each(Object.keys(CALLS))('%s', async id => {
        const requests = await capture(id)

        expect(requests.length, `${id} sent no request`).toBeGreaterThan(0)
        const report = requests
            .map(violations)
            .flatMap(({ endpoint, problems }) => problems.map(problem => `${endpoint}: ${problem}`))
        expect(report).toEqual([])
    })
})

/**
 * Files outside src/requests/ that send requests themselves, and so escape the
 * check above. The list may only shrink: moving one of these calls into
 * src/requests/ (and CALLS) is how it gets covered.
 */
const BYPASSES_REQUESTS: Record<string, string> = {
    '/src/stores/settings/index.ts': 'asks Last.fm itself for the auth token — never touches our API',
    '/src/config.ts': 'imports axios only to set its base URL',
}

const SENDS_REQUESTS = /from\s+['"](?:axios|[^'"]*requests\/useAxios)['"]/

describe('requests are sent from src/requests/ only', () => {
    const sources = import.meta.glob(['/src/**/*.ts', '/src/**/*.vue', '!/src/requests/**', '!/src/**/__tests__/**'], {
        as: 'raw',
        eager: true,
    }) as Record<string, string>

    it('reads the source tree (guards the glob itself)', () => {
        expect(Object.keys(sources).length).toBeGreaterThan(200)
        expect(sources['/src/stores/settings/index.ts']).toMatch(SENDS_REQUESTS)
    })

    it('no new file sends requests on its own, and the known ones are still listed truthfully', () => {
        const senders = Object.keys(sources).filter(path => SENDS_REQUESTS.test(sources[path]))
        const unlisted = senders.filter(path => !(path in BYPASSES_REQUESTS))
        const stale = Object.keys(BYPASSES_REQUESTS).filter(path => !senders.includes(path))

        expect(unlisted, 'put the request in src/requests/ and add it to CALLS').toEqual([])
        expect(stale, 'no longer sends requests itself — remove it from BYPASSES_REQUESTS').toEqual([])
    })
})

describe('the scrobble worker', () => {
    // The play log is the one request that does not go through src/requests/:
    // `sendLogData` hands it to a Web Worker, which builds its own body with
    // `fetch`. It is also the most-called write path there is, and nothing in
    // the UI reacts when the server rejects it, so it is read from source and
    // held against the same contract. The server end is pinned in
    // tests_api/test_scrobble_log.py.
    const source = readFileSync('public/workers/logtrack.js', 'utf-8')

    const path = source.match(/url\s*=\s*base_url\s*\+\s*"([^"]+)"/)?.[1]
    const method = source.match(/method:\s*"(\w+)"/)?.[1]
    const fields = (source.match(/JSON\.stringify\(\{([^}]*)\}\)/)?.[1] ?? '')
        .split(',')
        .map(field => field.trim())
        .filter(Boolean)

    it('reads the worker (guards this parser)', () => {
        expect(path).toBe('/logger/track/log')
        expect(method).toBe('POST')
        expect(fields.length).toBeGreaterThanOrEqual(4)
    })

    it('posts a body the server reads in full', () => {
        const data = Object.fromEntries(fields.map(field => [field, 'value']))
        const { problems } = violations({ method, url: path, data })

        expect(problems).toEqual([])
    })
})

describe('the checker itself', () => {
    // A contract check whose matcher breaks goes quietly green; these pin it.
    it('reads a contract with the known shapes', () => {
        expect(Object.keys(CONTRACT).length).toBeGreaterThan(100)
        expect(CONTRACT['PUT /playlists/{playlistid}/update'].body?.files).toEqual(['image'])
    })

    it('flags the #36 shape: a required field the client does not send', () => {
        const request = { method: 'put', url: '/playlists/7/update', data: form({ name: 'Mix' }) }
        expect(violations(request).problems).toEqual(['required body field "settings" is missing'])
    })

    it('flags an unknown endpoint, an unread field and the wrong body type', () => {
        expect(violations({ method: 'get', url: '/nope' }).problems).toEqual(['no such endpoint on the server'])
        expect(
            violations({ method: 'put', url: '/playlists/7/update', data: { name: 'x', settings: '{}' } }).problems
        ).toEqual(['body must be multipart FormData'])
        expect(
            violations({
                method: 'put',
                url: '/playlists/7/update',
                data: form({ name: 'x', settings: '{}', colour: 'red' }),
            }).problems
        ).toEqual(['body field "colour" is not read by the server'])
    })
})
