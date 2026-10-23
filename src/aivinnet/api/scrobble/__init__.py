import locale
import time
from datetime import date, datetime
from gettext import ngettext
from typing import Literal

import pendulum
from flask_openapi3 import APIBlueprint, Tag
from pydantic import BaseModel, Field

from aivinnet.api.apischemas import TrackHashSchema
from aivinnet.db.userdata import FavoritesTable, PlaylistTable, ScrobbleTable, UserTable
from aivinnet.lib import playlistlib
from aivinnet.lib.discoveries import first_heard_in
from aivinnet.lib.extras import get_extra_info
from aivinnet.lib.first_play_cache import first_plays_of
from aivinnet.lib.home.homerows import CUSTOM_PLAYLISTS
from aivinnet.lib.listening_calendar import build_calendar
from aivinnet.lib.listening_sources import count_kinds, shares_text, source_shares
from aivinnet.lib.name_cleanup import current_trackhash
from aivinnet.lib.placeholder_artists import PLACEHOLDER_ARTIST_HASHES
from aivinnet.lib.recipes.continuelistening import ContinueListening
from aivinnet.lib.recipes.homerows import almost_complete_played, track_facts
from aivinnet.lib.recipes.recents import RecentlyPlayed
from aivinnet.lib.rewind import build_rewind, finished_years, fresh_year, seen_years
from aivinnet.models.album import Album
from aivinnet.models.stats import StatItem
from aivinnet.models.track import Track
from aivinnet.models.user import REWIND_SEEN_KEY
from aivinnet.plugins.lastfm import LastFmPlugin
from aivinnet.serializers.album import serialize_for_card as serialize_for_album_card
from aivinnet.serializers.artist import serialize_for_card
from aivinnet.serializers.playlist import serialize_for_card as serialize_for_playlist_card
from aivinnet.serializers.track import serialize_track
from aivinnet.settings import Defaults
from aivinnet.store.albums import AlbumStore
from aivinnet.store.artists import ArtistStore
from aivinnet.store.tracks import TrackStore
from aivinnet.utils.auth import get_current_userid
from aivinnet.utils.dates import (
    get_date_range,
    get_previous_period_start,
    seconds_to_time_string,
)
from aivinnet.utils.stats import (
    calculate_album_trend,
    calculate_artist_trend,
    calculate_playlist_trend,
    calculate_scrobble_trend,
    calculate_track_trend,
    get_albums_in_period,
    get_artists_in_period,
    get_playlists_in_period,
    get_tracks_in_period,
    summarize_tracks_in_period,
)

bp_tag = Tag(name="Logger", description="Log item plays")
api = APIBlueprint("logger", __name__, url_prefix="/logger", abp_tags=[bp_tag])


# Year 5138: no clock reaches it, every timestamp in milliseconds does.
MAX_SCROBBLE_TIMESTAMP = 10**11


# The periods the stats page offers: the chart tabs and the tiles under them.
StatsPeriod = Literal["day", "week", "month", "year", "alltime"]


class LogTrackBody(TrackHashSchema):
    timestamp: int = Field(description="The timestamp of the track")
    duration: int = Field(description="The duration of the track in seconds")
    # Bounded: stored with every play. A folder source is a path, so room
    # for one at the usual PATH_MAX (#297).
    source: str = Field(
        max_length=4200,
        description="The play source of the track",
        json_schema_extra={
            "examples": [
                f"al:{Defaults.API_ALBUMHASH}",
                f"tr:{Defaults.API_TRACKHASH}",
                f"ar:{Defaults.API_ARTISTHASH}",
            ]
        },
    )


def format_date(start: float, end: float):
    first = pendulum.from_timestamp(start, tz="local").format("MMM D, YYYY")
    last = pendulum.from_timestamp(end, tz="local").format("MMM D, YYYY")

    # "day" starts and ends on the same date: "Oct 8, 2026", not "Oct 8, 2026 - Oct 8, 2026".
    return first if first == last else f"{first} - {last}"


@api.post("/track/log")
def log_track(body: LogTrackBody):
    """
    Log a track play to the database.
    """
    timestamp = body.timestamp
    duration = body.duration

    # `not timestamp` let negative values through; they reached the home-row
    # routines, which assume a real point in time. From above too: one play in
    # milliseconds sorted first forever and `/nothome/` 500ed on it (#391).
    # A fixed ceiling, not "now": a server whose clock lags (a Raspberry Pi
    # without RTC before NTP) would otherwise refuse real plays.
    if not timestamp or timestamp < 0 or timestamp >= MAX_SCROBBLE_TIMESTAMP or duration < 5:
        return {"msg": "Invalid entry."}, 400

    # A play from a queue saved before the name cleanup carries the old hash
    # (lib/name_cleanup.py): it counts for the track under its current one.
    trackhash = current_trackhash(body.trackhash)
    trackentry = TrackStore.trackhashmap.get(trackhash)
    if trackentry is None:
        return {"msg": "Track not found."}, 404

    scrobble_data = {**dict(body), "trackhash": trackhash}
    # REVIEW: Do we need to store the extra info in the database?
    # OR .... can we just write it to the backup file on demand?
    scrobble_data["extra"] = get_extra_info(trackhash, "track")
    ScrobbleTable.add(scrobble_data)

    # NOTE: Update the recently played homepage for this userid
    RecentlyPlayed(userid=scrobble_data["userid"])
    ContinueListening(userid=scrobble_data["userid"])
    almost_complete_played(scrobble_data["userid"], scrobble_data["trackhash"])

    # Update play data on the in-memory stores
    track = trackentry.tracks[0]
    album = AlbumStore.albummap.get(track.albumhash)

    if album:
        album.increment_playcount(duration, timestamp)

    for hash in track.artisthashes:
        artist = ArtistStore.artistmap.get(hash)

        if artist:
            artist.increment_playcount(duration, timestamp)

    trackentry.increment_playcount(duration, timestamp)
    track = trackentry.tracks[0]

    lastfm = LastFmPlugin(current_userid=get_current_userid())

    if (
        lastfm.enabled and track.duration > 30 and body.duration >= min(track.duration / 2, 240)
        # SEE: https://www.last.fm/api/scrobbling#when-is-a-scrobble-a-scrobble
    ):
        lastfm.scrobble(trackentry.tracks[0], timestamp)

    return {"msg": "recorded"}, 201


class ChartItemsQuery(BaseModel):
    duration: StatsPeriod = Field(
        "year",
        description="Duration to fetch data for",
    )
    # Capped: the client pages by 10 or 50 (chartPager.ts), and every chart
    # handler serialises and trend-scans each returned item on the single
    # request thread — limit=1000000 froze the app for over a minute.
    limit: int = Field(10, ge=1, le=100, description="Number of top tracks to return")
    offset: int = Field(0, ge=0, description="Number of items to skip (pagination)")
    order_by: Literal["playcount", "playduration"] = Field("playduration", description="Property to order by")


def paginate_window(items: list, offset: int, limit: int) -> tuple[list, int]:
    """
    Slice one page out of a fully sorted chart list and report the
    pre-slice total, so clients can render pagination controls.
    """
    return items[offset : offset + limit], len(items)


# SECTION: STATS


def get_help_text(playcount: int, playduration: int, order_by: Literal["playcount", "playduration"]):
    """
    Get the help text given the playcount and playduration.
    """
    if order_by == "playcount":
        if playcount == 0:
            return "unplayed"

        return f"{playcount} play{'' if playcount == 1 else 's'}"
    if order_by == "playduration":
        return seconds_to_time_string(playduration)


def chart_item_extra(playcount: int, playduration: int, extra: dict | None = None) -> dict:
    """
    The per-item stats payload every chart endpoint attaches as `extra`.

    The client's leaderboard meter needs the RAW seconds next to the
    preformatted `help_text` — additive, so older clients simply ignore it.
    `extra` merges endpoint-specific fields already living there (the artist
    and playlist charts exposed `playcount` this way before).
    """
    return {**(extra or {}), "playcount": playcount, "playduration": playduration}


def max_playduration(durations) -> int:
    """
    The period's #1 play duration — the 100% reference for the client's
    leaderboard meters. 0 means "no data" and hides the meters.
    """
    return max(durations, default=0)


# DISCLAIMER: Code beyond this point was partially written by Claude 3.5 Sonnet in Cursor.
# TODO: Refactor, group and clean up


@api.get("/top-tracks")
def get_top_tracks(query: ChartItemsQuery):
    """
    Get the top N tracks played within a given duration.
    """
    start_time, end_time = get_date_range(query.duration)
    previous_start_time = get_previous_period_start(query.duration, start_time)

    current_period_tracks, current_period_scrobbles, duration = get_tracks_in_period(start_time, end_time)
    previous_period_tracks, previous_period_scrobbles, _ = get_tracks_in_period(previous_start_time, start_time)
    scrobble_trend = (
        "rising"
        if current_period_scrobbles > previous_period_scrobbles
        else ("falling" if current_period_scrobbles < previous_period_scrobbles else "stable")
    )

    sorted_tracks = sort_tracks(current_period_tracks, query.order_by)
    top_tracks, total = paginate_window(sorted_tracks, query.offset, query.limit)

    response = []
    for track in top_tracks:
        trend = calculate_track_trend(track, current_period_tracks, previous_period_tracks)
        serialized = serialize_track(track)
        track = {
            **serialized,
            "trend": trend,
            "help_text": get_help_text(track.playcount, track.playduration, query.order_by),
            "extra": chart_item_extra(track.playcount, track.playduration, serialized.get("extra")),
        }

        response.append(track)

    return {
        "tracks": response,
        "total": total,
        "max_playduration": max_playduration(t.playduration for t in sorted_tracks),
        "scrobbles": {
            "text": f"{current_period_scrobbles} total play{'' if current_period_scrobbles == 1 else 's'} ({seconds_to_time_string(duration)})",
            "trend": scrobble_trend,
            "dates": format_date(start_time, end_time),
        },
    }, 200


def sort_tracks(tracks: list[Track], order_by: Literal["playcount", "playduration"]):
    return sorted(tracks, key=lambda x: getattr(x, order_by), reverse=True)


@api.get("/top-artists")
def get_top_artists(query: ChartItemsQuery):
    """
    Get the top N artists played within a given duration.
    """
    start_time, end_time = get_date_range(query.duration)
    previous_start_time = get_previous_period_start(query.duration, start_time)

    current_period_artists = get_artists_in_period(start_time, end_time)
    previous_period_artists = get_artists_in_period(previous_start_time, start_time)

    new_artists = len(discovered_in(get_current_userid(), start_time, end_time)[0])
    scrobble_trend = calculate_scrobble_trend(len(current_period_artists), len(previous_period_artists))

    sorted_artists = sort_artists(current_period_artists, query.order_by)

    # Resolve validity BEFORE windowing (like the playlists endpoint): an
    # artist that left the library must not inflate `total` or thin a page.
    valid_artists = []
    for artist in sorted_artists:
        db_artist = ArtistStore.get_artist_by_hash(artist["artisthash"])

        if db_artist is None:
            continue

        valid_artists.append((artist, db_artist))

    top_artists, total = paginate_window(valid_artists, query.offset, query.limit)

    response = []
    for artist, db_artist in top_artists:
        trend = calculate_artist_trend(artist, current_period_artists, previous_period_artists)

        artist = {
            **serialize_for_card(db_artist),
            "trend": trend,
            "help_text": get_help_text(artist["playcount"], artist["playduration"], query.order_by),
            "extra": chart_item_extra(artist["playcount"], artist["playduration"]),
        }
        response.append(artist)

    return {
        "artists": response,
        "total": total,
        "max_playduration": max_playduration(entry["playduration"] for entry, _ in valid_artists),
        "scrobbles": {
            "text": f"{new_artists} {'new' if query.duration != 'alltime' else ''} {ngettext('artist', 'artists', new_artists)}",
            "trend": scrobble_trend,
            "dates": format_date(start_time, end_time),
        },
    }, 200


def sort_artists(artists, order_by):
    return sorted(artists, key=lambda x: x[order_by], reverse=True)


@api.get("/top-albums")
def get_top_albums(query: ChartItemsQuery):
    """
    Get the top N albums played within a given duration.
    """
    start_time, end_time = get_date_range(query.duration)
    previous_start_time = get_previous_period_start(query.duration, start_time)

    current_period_albums = get_albums_in_period(start_time, end_time)
    previous_period_albums = get_albums_in_period(previous_start_time, start_time)

    new_albums = len(discovered_in(get_current_userid(), start_time, end_time)[1])
    scrobble_trend = calculate_scrobble_trend(len(current_period_albums), len(previous_period_albums))

    sorted_albums = sort_albums(current_period_albums, query.order_by)
    top_albums, total = paginate_window(sorted_albums, query.offset, query.limit)

    response = []
    for album in top_albums:
        trend = calculate_album_trend(album, current_period_albums, previous_period_albums)
        album = {
            **serialize_for_album_card(album),
            "trend": trend,
            "help_text": get_help_text(album.playcount, album.playduration, query.order_by),
            "extra": chart_item_extra(album.playcount, album.playduration),
        }
        response.append(album)

    return {
        "albums": response,
        "total": total,
        "max_playduration": max_playduration(a.playduration for a in sorted_albums),
        "scrobbles": {
            "text": f"{new_albums} new album{'' if new_albums == 1 else 's'} played",
            "trend": scrobble_trend,
            "dates": format_date(start_time, end_time),
        },
    }, 200


def sort_albums(albums: list[Album], order_by: Literal["playcount", "playduration"]):
    return sorted(albums, key=lambda x: getattr(x, order_by), reverse=True)


@api.get("/top-playlists")
def get_top_playlists(query: ChartItemsQuery):
    """
    Get the top N playlists played within a given duration.

    A playlist is credited only for plays started from it (scrobble source
    ``pl:<id>``). Dynamic/custom playlists (non-numeric ids) are skipped.
    """
    start_time, end_time = get_date_range(query.duration)
    previous_start_time = get_previous_period_start(query.duration, start_time)

    current_period_playlists = get_playlists_in_period(start_time, end_time)
    previous_period_playlists = get_playlists_in_period(previous_start_time, start_time)

    scrobble_trend = calculate_scrobble_trend(len(current_period_playlists), len(previous_period_playlists))

    sorted_playlists = sort_playlists(current_period_playlists, query.order_by)

    # Resolve validity BEFORE windowing: dynamic playlists (non-numeric ids
    # like "recentlyadded") and deleted playlists are invisible to the client,
    # so they must not count towards `total` or shift the offset window.
    valid_playlists = []
    for entry in sorted_playlists:
        try:
            playlist = PlaylistTable.get_by_id(int(entry["playlistid"]))
        except (ValueError, TypeError):
            continue

        if playlist is None:
            # Playlist was deleted; old scrobbles still carry its id.
            continue

        valid_playlists.append((entry, playlist))

    window, total = paginate_window(valid_playlists, query.offset, query.limit)

    response = []
    for entry, playlist in window:
        trend = calculate_playlist_trend(entry, current_period_playlists, previous_period_playlists)

        if not playlist.has_image:
            playlist.images = playlistlib.get_first_4_images(trackhashes=playlist.trackhashes)
        playlist.clear_lists()

        response.append(
            {
                **serialize_for_playlist_card(playlist),
                "trend": trend,
                "help_text": get_help_text(entry["playcount"], entry["playduration"], query.order_by),
                "extra": chart_item_extra(entry["playcount"], entry["playduration"]),
            }
        )

    return {
        "playlists": response,
        "total": total,
        "max_playduration": max_playduration(entry["playduration"] for entry, _ in valid_playlists),
        "scrobbles": {
            "text": f"{len(current_period_playlists)} playlist{'' if len(current_period_playlists) == 1 else 's'} played",
            "trend": scrobble_trend,
            "dates": format_date(start_time, end_time),
        },
    }, 200


def sort_playlists(playlists: list[dict], order_by: Literal["playcount", "playduration"]):
    return sorted(playlists, key=lambda x: x[order_by], reverse=True)


# The last calendar per user, with what it was built from. The grouping runs
# over the whole history on the request thread (measured ~200 ms for 150,000
# plays), so a revisit on the same day and without a new play reuses it.
_calendars: dict[int, tuple[tuple[str, int, int], dict]] = {}


@api.get("/calendar")
def get_listening_calendar():
    """
    The listening calendar: seconds listened per day over the last year, and
    the current and longest streak of days in a row with music.
    """
    userid = get_current_userid()
    today = ScrobbleTable.local_today()
    key = (today, *ScrobbleTable.change_marker(userid))

    cached = _calendars.get(userid)
    if cached is None or cached[0] != key:
        cached = (key, build_calendar(ScrobbleTable.seconds_per_day(userid), date.fromisoformat(today)))
        _calendars[userid] = cached

    return cached[1], 200


class RewindQuery(BaseModel):
    year: int | None = Field(
        None, ge=1970, le=9999, description="The year to look back on; the latest finished year by default"
    )


# The last Rewind each user opened, with the year and the plays it was built
# from — a year is one read of every play in it on the request thread. One
# per user, so switching through the years holds no more than one page. The
# years a Rewind opens for are cached alongside: grouping every play by year
# is a scan as well.
_rewinds: dict[int, tuple[tuple[int, int, tuple[int, int]], dict]] = {}
_rewind_years: dict[int, tuple[tuple[int, tuple[int, int]], list[int]]] = {}


def _finished_years(userid: int, this_year: int, marker: tuple[int, int]) -> list[int]:
    """The finished years the user has plays in (`lib/rewind.finished_years`)."""
    # This year too: on January 1 a year opens without a new play.
    key = (this_year, marker)
    cached = _rewind_years.get(userid)
    if cached is None or cached[0] != key:
        played = ScrobbleTable.years_with_plays(int(time.time()), userid)
        cached = (key, finished_years(played, this_year))
        _rewind_years[userid] = cached

    return cached[1]


@api.get("/rewind/years")
def get_rewind_years():
    """
    The years a Rewind can be opened for: finished years with plays, oldest
    first. Cached, for the way to Rewind on the stats page. `seen`: the years
    the user has seen to the end; `fresh`: the latest year while it is still
    unseen (#572) — the one the stats page and, in January, Home announce.
    """
    userid = get_current_userid()
    years = _finished_years(userid, datetime.now().year, ScrobbleTable.change_marker(userid))
    seen = seen_years(UserTable.get_extra(userid).get(REWIND_SEEN_KEY))
    return {"years": years, "seen": seen, "fresh": fresh_year(years, seen)}, 200


class RewindSeenBody(BaseModel):
    year: int = Field(..., ge=1970, le=9999, description="The year of the Rewind seen to the end")


@api.post("/rewind/seen")
def mark_rewind_seen(body: RewindSeenBody):
    """
    The user has seen a Rewind to the end (#572): it stops announcing itself
    and keeps a hidden door (January 1 in the listening calendar). The guest
    account, shared by every guest, marks nothing.
    """
    userid = get_current_userid()
    if UserTable.is_guest(userid):
        return {"msg": "The guest account keeps Rewind as it is"}, 403

    years = _finished_years(userid, datetime.now().year, ScrobbleTable.change_marker(userid))
    if body.year not in years:
        return {"msg": f"No Rewind for {body.year}"}, 404

    seen = seen_years(UserTable.get_extra(userid).get(REWIND_SEEN_KEY))
    if body.year not in seen:
        seen = sorted([*seen, body.year])
        UserTable.set_extra(userid, REWIND_SEEN_KEY, seen)
    return {"seen": seen, "fresh": fresh_year(years, seen)}, 200


@api.get("/rewind")
def get_rewind(query: RewindQuery):
    """
    AivinNet Rewind: one year of listening — minutes, top artists, albums and
    tracks, the song of the summer, the first track, the busiest day, the new
    artists, how and when the user listens. Plus the years there are plays in.

    A year opens on January 1 of the next one: this year and later answer 404
    (with the years that are open). Days and years are the C library's local
    time, like the listening calendar on the same page
    (`ScrobbleTable.local_today`), not pendulum's zone.
    """
    userid = get_current_userid()
    this_year = datetime.now().year
    marker = ScrobbleTable.change_marker(userid)
    years = _finished_years(userid, this_year, marker)
    year = query.year or (years[-1] if years else this_year - 1)
    if year >= this_year:
        opens = f"{year + 1}-01-01"
        return {"error": f"Rewind {year} opens on January 1, {year + 1}", "opens": opens, "years": years}, 404

    key = (this_year, year, marker)
    cached = _rewinds.get(userid)
    if cached is None or cached[0] != key:
        cached = (key, _build_rewind(userid, year, years))
        _rewinds[userid] = cached

    return cached[1], 200


def _year_bounds(year: int) -> tuple[int, int] | None:
    """
    The first and last second of a local year — naive datetimes are the C
    library's local time, both ways. None for a year that clock cannot hold
    (after 9999 anywhere; on Windows before 1970 or after 3000): no play is
    in it.
    """
    try:
        return int(datetime(year, 1, 1).timestamp()), int(datetime(year + 1, 1, 1).timestamp()) - 1
    except (OverflowError, OSError, ValueError):
        return None


def _build_rewind(userid: int, year: int, years: list[int]) -> dict:
    bounds = _year_bounds(year)
    plays: list = []
    heard_before: set[str] = set()
    if bounds:
        plays = list(ScrobbleTable.get_all_in_period(*bounds, userid))
        for trackhash in ScrobbleTable.trackhashes_before(bounds[0], userid):
            facts = track_facts(trackhash)
            if facts:
                heard_before.update(facts.track_artists or facts.artists)

    numbers = build_rewind(
        plays,
        track_facts,
        None,
        heard_before,
        skip=PLACEHOLDER_ARTIST_HASHES.__contains__,
        generated=CUSTOM_PLAYLISTS,
    )

    def track(trackhash: str) -> dict | None:
        found = TrackStore.get_tracks_by_trackhashes([trackhash])
        return serialize_track(found[0]) if found else None

    def album(albumhash: str) -> dict | None:
        found = AlbumStore.get_album_by_hash(albumhash)
        return serialize_for_album_card(found) if found else None

    def artist(artisthash: str) -> dict | None:
        found = ArtistStore.get_artist_by_hash(artisthash)
        return serialize_for_card(found) if found else None

    def listed(rows, card, *fields):
        out = []
        for row in rows:
            item = card(row[0])
            if item:
                out.append({**item, **dict(zip(fields, row[1:], strict=False))})
        return out

    summer, first_play, busiest = numbers["summer_track"], numbers["first_track"], numbers["busiest_day"]
    summer_track = track(summer[0]) if summer else None
    first_track = track(first_play[0]) if first_play else None

    return {
        "year": year,
        "years": years,
        "plays": numbers["plays"],
        "seconds": numbers["seconds"],
        "days": numbers["days"],
        "top_artists": listed(numbers["top_artists"], artist, "seconds"),
        "top_albums": listed(numbers["top_albums"], album, "seconds"),
        "top_tracks": listed(numbers["top_tracks"], track, "seconds", "plays"),
        "summer_track": {"track": summer_track, "plays": summer[1]} if summer_track else None,
        "first_track": {"track": first_track, "timestamp": first_play[1]} if first_track else None,
        "busiest_day": {"date": busiest[0], "seconds": busiest[1]} if busiest else None,
        "new_artists": numbers["new_artists"],
        "new_artists_top": [a for a in map(artist, numbers["new_artists_top"]) if a],
        "listener": numbers["listener"],
        "time_of_day": numbers["time_of_day"],
    }


class StatsQuery(BaseModel):
    # The same periods as the charts above the tiles, and "week" by default:
    # the tiles were fixed to it, and the search page's library numbers
    # (`LibraryNumbers.vue`) still ask without a period.
    period: StatsPeriod = Field(
        "week",
        description="Period the listening tiles cover",
    )


SAID_PERIOD = {
    "day": "today",
    "week": "this week",
    "month": "this month",
    "year": "this year",
    "alltime": "all time",
}


def discovered_in(userid: int, start: int, end: int) -> tuple[list[str], list[str]]:
    """
    The artists and albums first heard in the range, latest first — only
    those still in the library, so the tile, the captions and the list behind
    the tile count the same set.
    """
    found = first_plays_of(userid)
    artists = [h for h in first_heard_in(found.artists, start, end) if ArtistStore.get_artist_by_hash(h) is not None]
    albums = [h for h in first_heard_in(found.albums, start, end) if AlbumStore.get_album_by_hash(h) is not None]
    return artists, albums


def discoveries_text(artists: int, albums: int) -> str:
    """ "7 artists · 12 albums" — the tile's caption says they are new."""
    return f"{artists} {ngettext('artist', 'artists', artists)} · {albums} {ngettext('album', 'albums', albums)}"


class DiscoveriesQuery(BaseModel):
    period: StatsPeriod = Field("week", description="The period the discoveries are in")
    limit: int = Field(100, ge=1, le=500, description="The most albums and the most artists to return")


def _first_heard_text(timestamp: int) -> str:
    when = pendulum.from_timestamp(timestamp, tz="local")
    return f"first played {when.format('MMM D' if when.year == pendulum.now().year else 'MMM D, YYYY')}"


@api.get("/discoveries")
def get_discoveries(query: DiscoveriesQuery):
    """
    The artists and albums the user played for the first time in the period
    (#539), the latest discovery first, as cards. What the "new artists · new
    albums" tile counts.
    """
    start_time, end_time = get_date_range(query.period)
    userid = get_current_userid()
    found = first_plays_of(userid)
    artisthashes, albumhashes = discovered_in(userid, start_time, end_time)

    # Only the cards that go out are serialized; the totals count them all.
    artists = []
    for artisthash in artisthashes[: query.limit]:
        card = serialize_for_card(ArtistStore.get_artist_by_hash(artisthash))
        card["help_text"] = _first_heard_text(found.artists[artisthash])
        artists.append({"type": "artist", "item": card})

    albums = []
    for albumhash in albumhashes[: query.limit]:
        card = serialize_for_album_card(AlbumStore.get_album_by_hash(albumhash))
        card["help_text"] = _first_heard_text(found.albums[albumhash])
        albums.append({"type": "album", "item": card})

    return {
        "artists": artists,
        "albums": albums,
        "total": {"artists": len(artisthashes), "albums": len(albumhashes)},
        "dates": format_date(start_time, end_time),
    }, 200


@api.get("/stats")
def get_stats(query: StatsQuery):
    """
    Get the stats for the user.
    """
    period = query.period
    start_time, end_time = get_date_range(period)
    said_period = SAID_PERIOD[period]

    count = len(TrackStore.get_flat_list())
    total_tracks = StatItem(
        "trackcount",
        "in your library",
        locale.format_string("%d", count, grouping=True) + " " + ngettext("track", "tracks", count),
    )

    # Grouped in SQL: since the tiles follow the period, "all time" asks here
    # too, and a copy of every track ever played would hold up the single
    # request thread (bjoern) for every other request.
    plays, listened, top = summarize_tracks_in_period(start_time, end_time)

    playcount = StatItem(
        "streams",
        said_period,
        f"{plays} track {ngettext('play', 'plays', plays)}",
    )

    playduration = StatItem(
        "playtime",
        said_period,
        f"{seconds_to_time_string(listened)} listened",
    )

    # The top track of the period, by time listened (like the charts)
    top_track = StatItem(
        "toptrack",
        f"Top track {said_period}",
        (top.title + " - " + top.artists[0]["name"] if top else "—"),
        (top.image if top else None),
        (top.trackhash if top else None),
    )

    userid = get_current_userid()
    new_artists, new_albums = discovered_in(userid, start_time, end_time)
    # "new" in the caption, not the value: "2 new artists · 2 new albums" ran
    # past the tile's two lines. Over all time everything heard counts.
    discoveries = StatItem(
        "discoveries",
        "heard all time" if period == "alltime" else f"new {said_period}",
        discoveries_text(len(new_artists), len(new_albums)),
    )

    # "How you listened" (#538): what the period's plays were started from,
    # every play counted like the plays tile. The rule is Rewind's listener.
    kinds = count_kinds(ScrobbleTable.plays_by_source_in_period(start_time, end_time, userid), CUSTOM_PLAYLISTS)
    # The caption is the period like the plays tile: "how you listened this
    # week" ran onto a second line and lifted the value out of the row.
    sources = StatItem("sources", said_period, shares_text(source_shares(kinds)))

    fav_count = FavoritesTable.count_favs_in_period(start_time, end_time)
    # Every favorite is a new one over all time; "7  favorites" with the
    # empty word left a double space.
    fav_word = "favorite" if fav_count == 1 else "favorites"
    favorites = StatItem(
        "favorites",
        said_period,
        f"{fav_count} {fav_word}" if period == "alltime" else f"{fav_count} new {fav_word}",
    )

    return {
        "stats": [
            top_track,
            playcount,
            playduration,
            favorites,
            discoveries,
            sources,
            total_tracks,
        ],
        "dates": format_date(start_time, end_time),
    }, 200
