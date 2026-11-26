/**
 * The glyph before a Home row's caption (user, 2026-11-26). "Pinned" on the
 * Playlists page had the first one, a pin; every Home row now says what it is
 * the same way. All glyphs are the chrome set (24 units, 2.4 stroke), so they
 * draw at one size and one weight next to each other.
 *
 * Chosen from a preview on the live Home, one recommendation and one
 * alternative per row; the recommendations went in.
 */
import type { Component } from 'vue'

import ArtistPlusSvg from '@/assets/icons/artist.plus.svg'
import CalendarDaySvg from '@/assets/icons/calendar.day.svg'
import CassetteSvg from '@/assets/icons/cassette.svg'
import CompassSvg from '@/assets/icons/compass.svg'
import GemSvg from '@/assets/icons/gem.svg'
import HeadphonesSvg from '@/assets/icons/headphones.svg'
import HeartDashedSvg from '@/assets/icons/heart.dashed.svg'
import HistorySvg from '@/assets/icons/history.svg'
import LayersSvg from '@/assets/icons/layers.svg'
import MoonSvg from '@/assets/icons/moon.outline.svg'
import ProgressSvg from '@/assets/icons/progress.svg'
import RepeatSvg from '@/assets/icons/repeat.svg'
import SparkleSvg from '@/assets/icons/sparkle.svg'
import StarFillSvg from '@/assets/icons/star.fill.svg'
import SunSvg from '@/assets/icons/sun.outline.svg'
import TraySvg from '@/assets/icons/tray.svg'

const BY_KEY: Record<string, Component> = {
    your_mixes: CassetteSvg,
    because_you_listened: HeadphonesSvg,
    on_repeat: RepeatSvg,
    recently_played: HistorySvg,
    never_played: SparkleSvg,
    artists_you_might_like: ArtistPlusSvg,
    deep_cuts: GemSvg,
    forgotten_favorites: HeartDashedSvg,
    top_rated: StarFillSvg,
    rediscover: CompassSvg,
    almost_complete: ProgressSvg,
    on_this_day: CalendarDaySvg,
    recently_added: TraySvg,
}

// "Your weekday evenings": the server renames the row every hour after the time
// band (lib/home/discover.py::TIME_BANDS — mornings, afternoons, evenings,
// nights), so the glyph follows the TITLE, not the key: a moon after dark, a
// sun by day.
const AFTER_DARK = /\b(evenings|nights)$/i

type Row = { key?: string; title?: string; url?: string; path?: string }

export function rowIcon(row: Row): Component | undefined {
    const key = row.key
    if (key === 'for_this_time') return AFTER_DARK.test((row.title ?? '').trim()) ? MoonSvg : SunSvg
    // Own keys only: a row key is server data, and `constructor` is no row.
    if (key && Object.prototype.hasOwnProperty.call(BY_KEY, key)) return BY_KEY[key]
    // A collection page the user made: its key is the page id, its link is
    // `collections/<id>` (store/homepage.py::_collections).
    if ((row.url ?? row.path ?? '').startsWith('collections/')) return LayersSvg
    return undefined
}
