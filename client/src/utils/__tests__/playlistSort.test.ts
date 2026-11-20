import { describe, expect, it } from 'vitest'

import type { Playlist, SmartPlaylist } from '@/interfaces'
import {
  lastUpdatedSeconds,
  matchesPlaylistSearch,
  normalizeSortKey,
  readPlaylistSortQuery,
  sortPlaylists,
  sortSmartPlaylists,
} from '@/utils/playlistSort'

// Shaped like GET /playlists (realistic: last_updated as the server writes it).
function pl(over: Partial<Playlist> & { name: string }): Playlist {
  return {
    id: 0,
    image: '',
    has_image: false,
    tracks: [],
    count: 0,
    _last_updated: '',
    thumb: '',
    duration: 0,
    settings: {} as Playlist['settings'],
    pinned: false,
    images: [],
    ...over,
  } as Playlist
}

const names = (list: { name: string }[]) => list.map(p => p.name)

const library = [
  pl({ id: 1, name: 'Bravo', count: 5, duration: 900, last_updated: '2026-03-01 10:00:00', lastplayed: 100, playcount: 4, playduration: 1200 }),
  pl({ id: 2, name: 'alpha', count: 12, duration: 3600, last_updated: '2026-01-15 08:30:00', lastplayed: 300, playcount: 9, playduration: 60 }),
  pl({ id: 3, name: 'Charlie', count: 1, duration: 120, last_updated: '2026-02-20 19:45:10', lastplayed: 200, playcount: 1, playduration: 9000 }),
]

describe('sortPlaylists: every key, both directions', () => {
  it('name ascending is case-insensitive, descending reverses it', () => {
    expect(names(sortPlaylists(library, 'name', false))).toEqual(['alpha', 'Bravo', 'Charlie'])
    expect(names(sortPlaylists(library, 'name', true))).toEqual(['Charlie', 'Bravo', 'alpha'])
  })

  it.each([
    ['count', ['Charlie', 'Bravo', 'alpha'], ['alpha', 'Bravo', 'Charlie']],
    ['duration', ['Charlie', 'Bravo', 'alpha'], ['alpha', 'Bravo', 'Charlie']],
    ['last_updated', ['alpha', 'Charlie', 'Bravo'], ['Bravo', 'Charlie', 'alpha']],
    ['lastplayed', ['Bravo', 'Charlie', 'alpha'], ['alpha', 'Charlie', 'Bravo']],
    ['playcount', ['Charlie', 'Bravo', 'alpha'], ['alpha', 'Bravo', 'Charlie']],
    ['playduration', ['alpha', 'Bravo', 'Charlie'], ['Charlie', 'Bravo', 'alpha']],
  ])('%s: ascending then descending', (key, asc, desc) => {
    // Ascending lists the smallest value first; the expectations above encode
    // the fixture values, so a wrong comparator fails on a concrete order.
    expect(names(sortPlaylists(library, key, false))).toEqual(asc)
    expect(names(sortPlaylists(library, key, true))).toEqual(desc)
  })
})

describe('ties and missing values', () => {
  it('ties fall back to the name ascending, in both directions', () => {
    const list = [
      pl({ id: 1, name: 'Zed', count: 3 }),
      pl({ id: 2, name: 'Amy', count: 3 }),
      pl({ id: 3, name: 'mid', count: 7 }),
    ]
    expect(names(sortPlaylists(list, 'count', false))).toEqual(['Amy', 'Zed', 'mid'])
    // Reverse flips the key, not the tie-break: equal counts stay name ascending.
    expect(names(sortPlaylists(list, 'count', true))).toEqual(['mid', 'Amy', 'Zed'])
  })

  it('missing stats count as 0', () => {
    const list = [
      pl({ id: 1, name: 'Plays known', playcount: 2 }),
      pl({ id: 2, name: 'No plays' }),
      pl({ id: 3, name: 'Never played', lastplayed: 0 }),
    ]
    expect(names(sortPlaylists(list, 'playcount', false))).toEqual(['Never played', 'No plays', 'Plays known'])
    expect(names(sortPlaylists(list, 'lastplayed', false))).toEqual(['Never played', 'No plays', 'Plays known'])
  })

  it('non-finite stat values count as 0', () => {
    const list = [
      pl({ id: 1, name: 'b', playduration: Number.NaN }),
      pl({ id: 2, name: 'a', playduration: 5 }),
    ]
    expect(names(sortPlaylists(list, 'playduration', false))).toEqual(['b', 'a'])
  })
})

describe('last_updated normalisation', () => {
  it('reads a number as unix seconds, as is', () => {
    expect(lastUpdatedSeconds(pl({ name: 'x', last_updated: 1_700_000_000 }))).toBe(1_700_000_000)
  })

  it('reads the "YYYY-MM-DD HH:MM:SS" string like Date.parse on the ISO form', () => {
    const expected = Date.parse('2026-03-01T10:00:00') / 1000
    expect(lastUpdatedSeconds(pl({ name: 'x', last_updated: '2026-03-01 10:00:00' }))).toBe(expected)
  })

  it('an unreadable or missing value is 0', () => {
    expect(lastUpdatedSeconds(pl({ name: 'x', last_updated: 'not a date' }))).toBe(0)
    expect(lastUpdatedSeconds(pl({ name: 'x' }))).toBe(0)
  })

  it('sorts a string and a number on the same timeline', () => {
    const list = [
      pl({ id: 1, name: 'string', last_updated: '2026-03-01 00:00:00' }),
      pl({ id: 2, name: 'number', last_updated: Date.parse('2026-02-01T00:00:00') / 1000 }),
    ]
    expect(names(sortPlaylists(list, 'last_updated', false))).toEqual(['number', 'string'])
  })
})

describe('sort state', () => {
  it('does not mutate the input array (the sidebar shares it)', () => {
    const before = names(library)
    const copy = [...library]
    const out = sortPlaylists(library, 'name', true)
    expect(out).not.toBe(library)
    expect(names(library)).toEqual(before)
    expect(library).toEqual(copy)
  })

  it('unknown sortby falls back to name', () => {
    expect(normalizeSortKey('bogus')).toBe('name')
    expect(normalizeSortKey(undefined)).toBe('name')
    expect(names(sortPlaylists(library, 'bogus', false))).toEqual(['alpha', 'Bravo', 'Charlie'])
  })

  it('no sortby in the URL is name ascending, even with reverse set', () => {
    expect(readPlaylistSortQuery({})).toEqual({ sortby: 'name', reverse: false })
    expect(readPlaylistSortQuery({ reverse: '1' })).toEqual({ sortby: 'name', reverse: false })
  })

  it('reverse=1 means descending, anything else ascending', () => {
    expect(readPlaylistSortQuery({ sortby: 'count', reverse: '1' })).toEqual({ sortby: 'count', reverse: true })
    expect(readPlaylistSortQuery({ sortby: 'count', reverse: '0' })).toEqual({ sortby: 'count', reverse: false })
    expect(readPlaylistSortQuery({ sortby: 'nope', reverse: '1' })).toEqual({ sortby: 'name', reverse: true })
  })
})

describe('smart playlists: always by name', () => {
  const smart = [
    { id: 1, name: 'Late' },
    { id: 2, name: 'early' },
  ] as SmartPlaylist[]

  it('ascending by default and for any count-like key', () => {
    expect(names(sortSmartPlaylists(smart, 'name', false))).toEqual(['early', 'Late'])
    expect(names(sortSmartPlaylists(smart, 'count', true))).toEqual(['early', 'Late'])
    expect(names(sortSmartPlaylists(smart, 'playcount', false))).toEqual(['early', 'Late'])
  })

  it('descending only for the name chip with reverse', () => {
    expect(names(sortSmartPlaylists(smart, 'name', true))).toEqual(['Late', 'early'])
  })

  it('does not mutate its input', () => {
    const before = [...smart]
    sortSmartPlaylists(smart, 'name', true)
    expect(smart).toEqual(before)
  })
})

describe('matchesPlaylistSearch', () => {
  it('is case-insensitive', () => {
    expect(matchesPlaylistSearch('Road Trip', 'ROAD')).toBe(true)
  })

  it('is accent-insensitive in both directions', () => {
    expect(matchesPlaylistSearch('Café Jazz', 'cafe')).toBe(true)
    expect(matchesPlaylistSearch('cafe jazz', 'CAFÉ')).toBe(true)
    expect(matchesPlaylistSearch('Über alles', 'uber')).toBe(true)
  })

  it('is a substring match, not a prefix match', () => {
    expect(matchesPlaylistSearch('Summer Hits 2019', 'hits')).toBe(true)
    expect(matchesPlaylistSearch('Summer Hits', 'winter')).toBe(false)
  })

  it('trims the term; a blank term matches everything', () => {
    expect(matchesPlaylistSearch('Workout', '  work  ')).toBe(true)
    expect(matchesPlaylistSearch('Workout', '   ')).toBe(true)
    expect(matchesPlaylistSearch('', '')).toBe(true)
  })
})
