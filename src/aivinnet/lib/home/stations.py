"""
Genre and decade stations of the Subspace radio (#640, #542): generated
playlists like "Your mixes", but cut from the whole library instead of the
user's sessions.

- A genre station is one of the user's most played genres (plays of the last
  `STATION_DAYS`; a play counts for each genre of its track).
- A decade station is one of the user's most played decades, read from the
  release year of the track (`utils.dates.tag_year`, UTC: a "2020" tag is
  2020-01-01 UTC, and in local time west of it that is 2019).

Both need `STATION_MIN_TRACKS` library tracks, and their tracks are drawn like
a mix: well-known tracks (played by the user) alternate with never-played
ones, at most `STATION_MAX_PER_ALBUM` per album, and the draw is re-made each
day with the date as seed.

Pure rules, like `mixes.py`: no database, no stores. The routine in
`lib/recipes/stations.py` hands in the library and the plays. Testable in the
fast lane, strict under mypy.
"""

import random
import zlib
from collections import Counter, defaultdict, deque
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from aivinnet.lib.home.discover import DAY, Play, TrackFacts, _artists, _resolve
from aivinnet.utils.dates import tag_year

# The taste of the last half year, as "Your mixes" reads it.
STATION_DAYS = 180
# Stations per kind: the dial has room for these, and no more.
STATION_COUNT = 4
# Plays of a genre or decade in the window before it is a station at all.
STATION_MIN_PLAYS = 3
# Library tracks in a genre or decade before it is a station.
STATION_MIN_TRACKS = 20
# A station with fewer tracks picked than this is no station (as mixes).
STATION_MIN_PICKED = 8
STATION_LENGTH = 30
STATION_MAX_PER_ALBUM = 3

GENRE_PLAYLIST_IDS = tuple(f"genre{n}" for n in range(1, STATION_COUNT + 1))
DECADE_PLAYLIST_IDS = tuple(f"decade{n}" for n in range(1, STATION_COUNT + 1))
STATION_PLAYLIST_IDS = (*GENRE_PLAYLIST_IDS, *DECADE_PLAYLIST_IDS)

GENRE = "genre"
DECADE = "decade"


@dataclass
class Station:
    kind: str
    # The genre hash, or the decade as text ("1980"): what a slot is kept by.
    key: str
    name: str
    tracks: list[str] = field(default_factory=list)


@dataclass(frozen=True)
class StationPools:
    """Per genre hash and per decade: the library tracks as (trackhash, albumhash)."""

    genres: Mapping[str, Sequence[tuple[str, str]]]
    decades: Mapping[str, Sequence[tuple[str, str]]]


def decade_of(release: int) -> int | None:
    """
    The decade of a release timestamp (`TrackFacts.release`), or None. Read
    with `tag_year`, so "2020" in a tag is 2020 wherever the server runs.
    """
    year = tag_year(release)
    if year is None:
        return None
    return year // 10 * 10


def decade_key(decade: int) -> str:
    return str(decade)


def decade_name(key: str) -> str:
    return f"{key}s"


def station_pools(
    library: Iterable[tuple[str, TrackFacts]],
    skip: Callable[[str], bool] = lambda artisthash: False,
) -> StationPools:
    """
    The library's tracks per genre and per decade. A track whose artists are
    all placeholders ("Unknown", untagged) is in no pool, the same way
    `mixes` leaves them out of a mix.
    """
    genres: defaultdict[str, list[tuple[str, str]]] = defaultdict(list)
    decades: defaultdict[str, list[tuple[str, str]]] = defaultdict(list)

    for trackhash, facts in library:
        if not _artists(facts, skip):
            continue
        entry = (trackhash, facts.albumhash)
        for genre in set(facts.genres):
            genres[genre].append(entry)
        decade = decade_of(facts.release)
        if decade is not None:
            decades[decade_key(decade)].append(entry)

    return StationPools(dict(genres), dict(decades))


def _seed(day: int, kind: str, key: str) -> int:
    """Stable across processes (`hash()` is not): one draw per station and day."""
    return day * 1_000_003 + zlib.crc32(f"{kind}:{key}".encode())


def station_tracks(
    pool: Sequence[tuple[str, str]],
    window_plays: Mapping[str, int],
    all_plays: Mapping[str, int],
    seed: int,
    length: int = STATION_LENGTH,
    max_per_album: int = STATION_MAX_PER_ALBUM,
) -> list[str]:
    """
    One station's tracks. Well-known: the pool's tracks the user has played,
    most played lately first; the top twice `length` of them are drawn from with
    the seed, so the list changes from day to day. Never played: drawn with the
    seed too. They alternate, at most `max_per_album` per album, each track once.
    """
    rng = random.Random(seed)
    album_of = dict(pool)

    # From the user's plays, not the pool: a genre can be most of the library,
    # the played tracks are a few thousand at most.
    known = sorted(
        (t for t in all_plays if all_plays[t] and t in album_of),
        key=lambda t: (-window_plays.get(t, 0), -all_plays[t], t),
    )[: 2 * length]
    fresh = sorted(t for t in album_of if not all_plays.get(t, 0))
    rng.shuffle(known)
    rng.shuffle(fresh)

    sides = [deque(known), deque(fresh)]
    picked: list[str] = []
    taken: set[str] = set()
    per_album: Counter[str] = Counter()
    turn = 0

    while len(picked) < length and (sides[0] or sides[1]):
        side = turn % 2
        if not sides[side]:
            side = 1 - side
        turn += 1
        trackhash = sides[side].popleft()
        album = album_of[trackhash]
        if trackhash in taken or per_album[album] >= max_per_album:
            continue
        taken.add(trackhash)
        per_album[album] += 1
        picked.append(trackhash)

    return picked


def build_stations(
    pools: StationPools,
    plays: Sequence[Play],
    facts_of: Callable[[str], TrackFacts | None],
    now: float,
    day: int,
    genre_names: Mapping[str, str],
    skip: Callable[[str], bool] = lambda artisthash: False,
) -> tuple[list[Station], list[Station]]:
    """
    The user's genre stations and decade stations, most played first, each
    kind at most `STATION_COUNT`. `day` is any int that changes daily.

    A candidate needs `STATION_MIN_PLAYS` plays in the window and
    `STATION_MIN_TRACKS` pool tracks; one whose tracks come out below
    `STATION_MIN_PICKED` gives its place to the next candidate.
    """
    resolved = _resolve(plays, facts_of)
    start = now - STATION_DAYS * DAY
    window = [r for r in resolved if start <= r.play.timestamp <= now]
    all_plays = Counter(r.play.trackhash for r in resolved)
    window_plays = Counter(r.play.trackhash for r in window)

    genre_plays: Counter[str] = Counter()
    decade_plays: Counter[str] = Counter()
    for r in window:
        if not _artists(r.facts, skip):
            continue
        genre_plays.update(set(r.facts.genres))
        decade = decade_of(r.facts.release)
        if decade is not None:
            decade_plays[decade_key(decade)] += 1

    genres = _stations(
        GENRE,
        genre_plays,
        pools.genres,
        lambda key: genre_names.get(key, key),
        window_plays,
        all_plays,
        day,
    )
    decades = _stations(DECADE, decade_plays, pools.decades, decade_name, window_plays, all_plays, day)
    return genres, decades


def _stations(
    kind: str,
    plays: Counter[str],
    pools: Mapping[str, Sequence[tuple[str, str]]],
    name_of: Callable[[str], str],
    window_plays: Mapping[str, int],
    all_plays: Mapping[str, int],
    day: int,
) -> list[Station]:
    ranked = sorted(
        (key for key, n in plays.items() if n >= STATION_MIN_PLAYS and len(pools.get(key, ())) >= STATION_MIN_TRACKS),
        key=lambda key: (-plays[key], key),
    )

    found: list[Station] = []
    for key in ranked:
        if len(found) >= STATION_COUNT:
            break
        tracks = station_tracks(pools[key], window_plays, all_plays, _seed(day, kind, key))
        if len(tracks) < STATION_MIN_PICKED:
            continue
        found.append(Station(kind, key, name_of(key), tracks))

    return found


def place_stations(
    found: Sequence[Station],
    previous: Sequence[str | None],
    slots: int = STATION_COUNT,
) -> list[Station | None]:
    """
    Each station in the slot its key had in the last run, the new ones in the
    free slots in order. A slot is served by its playlist id ("genre2"), so a
    station that dropped out must not shift the ones after it: an open card
    would play the next genre under the old name (see `mixes.place_mixes`).
    """
    placed: list[Station | None] = [None] * slots
    rest: list[Station] = []

    for station in found[:slots]:
        slot = next((i for i, key in enumerate(previous[:slots]) if key == station.key), None)
        if slot is not None and placed[slot] is None:
            placed[slot] = station
        else:
            rest.append(station)

    free = [i for i in range(slots) if placed[i] is None]
    for slot, station in zip(free, rest, strict=False):
        placed[slot] = station

    return placed


def station_listing(
    mixes: Sequence[Mapping[str, object] | None],
    stations: Mapping[str, Mapping[str, object]],
) -> list[dict[str, str]]:
    """
    The stations of a user, in dial order: mixes, genres, decades. A slot
    without a station is left out. `mixes` by position (each with a "name");
    `stations` by playlist id (each with "kind" and "name").
    """
    listing: list[dict[str, str]] = []

    for position, mix in enumerate(mixes[:STATION_COUNT]):
        if mix is not None:
            listing.append({"id": f"mix{position + 1}", "kind": "mix", "name": str(mix["name"])})

    for playlistid in STATION_PLAYLIST_IDS:
        station = stations.get(playlistid)
        if station is not None:
            listing.append({"id": playlistid, "kind": str(station["kind"]), "name": str(station["name"])})

    return listing
