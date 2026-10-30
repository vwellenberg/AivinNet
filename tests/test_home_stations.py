"""
The radio's genre and decade stations (`lib/home/stations.py`, #640): which
genres and decades qualify, how many, how their tracks are drawn, and where
each one sits on the dial.

The module imports no database or store code, so these run in the fast lane.
"""

from collections import Counter
from dataclasses import dataclass

from aivinnet.lib.home.discover import TrackFacts
from aivinnet.lib.home.stations import (
    STATION_COUNT,
    STATION_LENGTH,
    STATION_MAX_PER_ALBUM,
    STATION_MIN_PICKED,
    STATION_MIN_TRACKS,
    Station,
    build_stations,
    decade_of,
    place_stations,
    station_listing,
    station_pools,
    station_tracks,
)

DAY = 86400
NOW = 1_790_000_000
UNKNOWN = "unknown"


@dataclass
class Play:
    trackhash: str
    timestamp: int


def ts(year: int, month: int = 1, day: int = 1, hour: int = 0) -> int:
    """A UTC timestamp, as `taglib.parse_date` stores a release date."""
    from datetime import UTC, datetime

    return int(datetime(year, month, day, hour, tzinfo=UTC).timestamp())


def album_tracks(
    album: str,
    count: int,
    *,
    artist: str = "artist",
    genres: tuple[str, ...] = ("rock",),
    release: int = 0,
) -> list[tuple[str, TrackFacts]]:
    """`count` tracks of one album, as the library's (trackhash, facts) pairs."""
    return [
        (f"{album}/{n}", TrackFacts(albumhash=album, artists=(artist,), genres=genres, release=release))
        for n in range(1, count + 1)
    ]


def albums_of(prefix: str, albums: int, per_album: int = 10, **kwargs) -> list[tuple[str, TrackFacts]]:
    """`albums` albums of `per_album` tracks: a station draws at most three from each."""
    return [t for n in range(albums) for t in album_tracks(f"{prefix}{n}", per_album, **kwargs)]


def library_of(*albums: list[tuple[str, TrackFacts]]) -> dict[str, TrackFacts]:
    return {trackhash: facts for album in albums for trackhash, facts in album}


def plays_of(trackhash: str, times: int, ago_days: int = 5) -> list[Play]:
    return [Play(trackhash, int(NOW - ago_days * DAY - n * 60)) for n in range(times)]


def build(library: dict[str, TrackFacts], plays: list[Play], day: int = 1, genre_names=None):
    pools = station_pools(library.items())
    return build_stations(
        pools,
        plays,
        library.get,
        NOW,
        day,
        genre_names or {},
    )


def test_a_genre_needs_twenty_library_tracks():
    # Three albums (a station draws at most three tracks from each): 18 is one short.
    short = library_of(albums_of("a", 3, 6))
    genres, _ = build(short, plays_of("a0/1", 5))
    assert genres == []

    enough = library_of(albums_of("a", 3, 7))
    genres, _ = build(enough, plays_of("a0/1", 5))
    (station,) = genres
    assert station.key == "rock"
    assert len(station.tracks) >= STATION_MIN_PICKED


def test_at_most_four_genres_the_most_played_first():
    library = library_of(
        *[albums_of(f"g{n}-", 4, genres=(f"genre{n}",)) for n in range(6)],
    )
    # genre0 most played, genre5 least; all six qualify.
    plays = []
    for n in range(6):
        plays += plays_of(f"g{n}-0/1", times=10 - n)

    genres, _ = build(library, plays)

    assert len(genres) == STATION_COUNT == 4
    assert [s.key for s in genres] == ["genre0", "genre1", "genre2", "genre3"]


def test_a_genre_needs_three_plays_in_the_window_to_be_a_station():
    library = library_of(album_tracks("a1", 30))
    genres, _ = build(library, plays_of("a1/1", 2))
    assert genres == []


def test_the_window_counts_the_last_180_days_only():
    library = library_of(album_tracks("a1", 30))
    old = plays_of("a1/1", 10, ago_days=200)
    genres, _ = build(library, old)
    assert genres == []


def test_at_most_three_tracks_per_album():
    library = library_of(*[album_tracks(f"a{n}", 10) for n in range(4)])
    plays = plays_of("a0/1", 5)

    genres, _ = build(library, plays)
    (station,) = genres

    per_album = Counter(t.split("/")[0] for t in station.tracks)
    assert max(per_album.values()) <= STATION_MAX_PER_ALBUM
    # Four albums of ten: at most twelve, and the cap is what fills it.
    assert len(station.tracks) == 4 * STATION_MAX_PER_ALBUM
    assert len(set(station.tracks)) == len(station.tracks)


def test_a_station_has_at_most_thirty_tracks():
    library = library_of(*[album_tracks(f"a{n}", 3) for n in range(20)])
    plays = plays_of("a0/1", 5)

    genres, _ = build(library, plays)
    (station,) = genres
    assert len(station.tracks) <= STATION_LENGTH


def test_well_known_and_never_played_alternate():
    library = library_of(*[album_tracks(f"a{n}", 3) for n in range(10)])
    played = {"a0/1", "a1/1", "a2/1", "a3/1"}
    plays = [p for t in played for p in plays_of(t, 4)]
    all_plays = Counter(p.trackhash for p in plays)

    pool = [(t, t.split("/")[0]) for t in library]
    tracks = station_tracks(pool, all_plays, all_plays, seed=7)

    known = [t in played for t in tracks]
    # Known first, then never played, and so on while both last.
    assert known[0] is True
    assert known[1] is False
    assert known[:8] == [True, False] * 4


def test_the_draw_is_the_same_for_a_day_and_changes_with_the_day():
    library = library_of(*[album_tracks(f"a{n}", 3) for n in range(10)])
    plays = plays_of("a0/1", 5)

    (first,) = build(library, plays, day=100)[0]
    (again,) = build(library, plays, day=100)[0]
    (tomorrow,) = build(library, plays, day=101)[0]

    assert first.tracks == again.tracks
    assert first.tracks != tomorrow.tracks


def test_placeholder_artists_are_in_no_station():
    real = album_tracks("real", 10)
    untagged = album_tracks("untagged", 30, artist=UNKNOWN)
    library = library_of(real, untagged)
    plays = plays_of("real/1", 5) + plays_of("untagged/1", 50)

    pools = station_pools(library.items(), skip=lambda artisthash: artisthash == UNKNOWN)
    # Ten real tracks of rock: under the twenty needed, however many untagged ones there are.
    assert len(pools.genres["rock"]) == 10
    genres, _ = build_stations(pools, plays, library.get, NOW, 1, {}, skip=lambda a: a == UNKNOWN)
    assert genres == []


def test_a_placeholder_play_does_not_make_a_genre_a_station():
    # The untagged plays are fifty of the window; without the skip they would
    # make "rock" the top genre of a library where it is one of two.
    real = albums_of("real", 3, genres=("jazz",))
    untagged = albums_of("untagged", 3, artist=UNKNOWN, genres=("rock",))
    library = library_of(real, untagged)
    plays = plays_of("untagged0/1", 50) + plays_of("real0/1", 3)

    pools = station_pools(library.items(), skip=lambda a: a == UNKNOWN)
    genres, _ = build_stations(pools, plays, library.get, NOW, 1, {}, skip=lambda a: a == UNKNOWN)
    assert [s.key for s in genres] == ["jazz"]


def test_a_decade_is_read_from_the_release_year_tag():
    # "2020" in a tag is 2020-01-01 UTC: the decade is the 2020s wherever the
    # server runs (a local read gave 2019 west of UTC, #391).
    assert decade_of(ts(2020)) == 2020
    assert decade_of(ts(1999, 12, 31, 23)) == 1990
    assert decade_of(ts(1985, 6, 1)) == 1980
    # No release date (the scanner stored the file's mtime, or nothing): no decade.
    assert decade_of(0) is None


def test_a_decade_station_names_the_decade():
    library = library_of(albums_of("a", 3, release=ts(1984)), albums_of("b", 2, release=ts(2011)))
    plays = plays_of("a0/1", 5)

    _, decades = build(library, plays)
    (station,) = decades
    assert station.kind == "decade"
    assert station.key == "1980"
    assert station.name == "1980s"


def test_a_decade_needs_twenty_tracks_too():
    library = library_of(albums_of("a", 1, STATION_MIN_TRACKS - 1, release=ts(1984)))
    _, decades = build(library, plays_of("a0/1", 5))
    assert decades == []


def test_a_station_too_thin_to_fill_gives_its_place_to_the_next():
    # Pool of twenty tracks on ONE album: the per-album cap leaves three.
    one_album = album_tracks("thin", STATION_MIN_TRACKS)
    library = library_of(one_album, *[album_tracks(f"b{n}", 3, genres=("jazz",)) for n in range(10)])
    plays = plays_of("thin/1", 9) + plays_of("b0/1", 4)

    genres, _ = build(library, plays)
    assert [s.key for s in genres] == ["jazz"]


def test_a_station_keeps_the_slot_its_key_had():
    rock = Station("genre", "rock", "rock", ["x"])
    jazz = Station("genre", "jazz", "jazz", ["y"])

    placed = place_stations([jazz, rock], previous=["rock", None, None, None])
    assert placed[0] is not None and placed[0].key == "rock"
    assert placed[1] is not None and placed[1].key == "jazz"


def test_a_dropped_station_does_not_shift_the_ones_after_it():
    jazz = Station("genre", "jazz", "jazz", ["y"])

    # Rock was slot 1 and is gone: jazz stays in slot 2, slot 1 is empty.
    placed = place_stations([jazz], previous=["rock", "jazz", None, None])
    assert placed[0] is None
    assert placed[1] is not None and placed[1].key == "jazz"


def test_the_listing_is_mixes_then_genres_then_decades():
    mixes = [None, {"name": "Mix 2"}]
    stations = {
        "decade1": {"kind": "decade", "name": "1980s"},
        "genre2": {"kind": "genre", "name": "rock"},
        "genre1": {"kind": "genre", "name": "jazz"},
    }

    assert station_listing(mixes, stations) == [
        {"id": "mix2", "kind": "mix", "name": "Mix 2"},
        {"id": "genre1", "kind": "genre", "name": "jazz"},
        {"id": "genre2", "kind": "genre", "name": "rock"},
        {"id": "decade1", "kind": "decade", "name": "1980s"},
    ]


def test_the_listing_of_a_user_without_stations_is_empty():
    assert station_listing([], {}) == []
