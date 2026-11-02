"""
The seasonal stations of the radio (`lib/home/stations.py`): the Christmas
matcher, the New Year's Eve countdown, and where a season's station goes on
the dial. The module imports no database or store code, so these run in the
fast lane.
"""

from collections import namedtuple
from datetime import date

import pytest

from aivinnet.lib.home.stations import (
    COUNTDOWN_LENGTH,
    SEASON_MIN_TRACKS,
    Station,
    build_season_stations,
    christmas_pool,
    countdown_tracks,
    countdown_year,
    is_christmas,
    season_station_id,
    station_listing,
)

Play = namedtuple("Play", "trackhash timestamp")

NOW = 1_790_000_000
YEAR_START = 1_700_000_000
YEAR_END = YEAR_START + 365 * 86400
LIBRARY = frozenset(f"t{n}" for n in range(1, 200))


# --- The Christmas matcher -------------------------------------------------


@pytest.mark.parametrize(
    "genre",
    ["Christmas", "Xmas", "Weihnachtsmusik", "Holiday", "Noël", "Noel", "Navidad", "Post-Christmas Pop"],
)
def test_a_christmas_genre_makes_a_christmas_track(genre):
    assert is_christmas("Some Song", [genre])


@pytest.mark.parametrize(
    "title",
    [
        "Jingle Bells",
        "Silent Night",
        "Stille Nacht",
        "O du fröhliche",
        "O du frohliche",  # the umlaut folded away
        "Leise rieselt der Schnee",
        "Last Christmas",
        "White Christmas",
        "Santa Claus Is Comin' to Town",
        "Rudolph the Red-Nosed Reindeer",
        "Let It Snow! Let It Snow!",
        "Feliz Navidad",
        "Weihnachtslieder",
        "Winter Wonderland",
        "Deck the Halls",
    ],
)
def test_a_christmas_title_makes_a_christmas_track(title):
    assert is_christmas(title, ["Pop"])


@pytest.mark.parametrize(
    "title",
    [
        "Santana - Smooth",  # "santa" followed by a letter
        "Santanas Song",
        "Rudolphine",  # "rudolph" followed by a letter
        "Silent Nights Remix",  # "silent night" followed by a letter
        "Pixmas Party",  # "xmas" preceded by a letter
        "Unsleigh",  # "sleigh" preceded by a letter
    ],
)
def test_a_keyword_inside_a_word_is_not_christmas(title):
    # Word boundaries on both sides of a title keyword: "Santana" is not "Santa".
    assert not is_christmas(title, ["Rock"])


def test_an_ordinary_track_is_not_christmas():
    assert not is_christmas("Paranoid Android", ["Rock", "Alternative"])


def test_the_genre_is_matched_anywhere_in_its_name_the_title_on_word_boundaries():
    # "Christmas" inside a genre name counts; inside a title it must be a word.
    assert is_christmas("Plain Title", ["Pop/Christmas"])
    assert not is_christmas("Christmasland Tour", ["Rock"])  # not Christmas: "christmasland" is a word


def test_the_pool_keeps_only_the_christmas_tracks():
    rows = [
        ("t1", "a1", "Jingle Bells", ["Pop"]),
        ("t2", "a1", "Paranoid Android", ["Rock"]),
        ("t3", "a2", "Santana - Smooth", ["Latin"]),
        ("t4", "a2", "Something", ["Christmas"]),
    ]

    assert christmas_pool(rows) == [("t1", "a1"), ("t4", "a2")]


# --- The countdown ---------------------------------------------------------


def play_counts(counts: dict[str, int], timestamp: int = YEAR_START + 100) -> list[Play]:
    return [Play(trackhash, timestamp) for trackhash, n in counts.items() for _ in range(n)]


def test_the_countdown_runs_from_thirty_to_one():
    # Track n has n plays: the thirty most played are 6..35, and the favourite is last.
    counts = {f"t{n}": n for n in range(1, 36)}

    order = countdown_tracks(play_counts(counts), YEAR_START, YEAR_END, LIBRARY)

    assert len(order) == COUNTDOWN_LENGTH == 30
    assert order[0] == "t6"  # #30: the thirtieth most played
    assert order[-1] == "t35"  # #1: the favourite plays last
    assert order == [f"t{n}" for n in range(6, 36)]


def test_fewer_than_five_tracks_is_no_countdown():
    counts = {f"t{n}": 3 for n in range(1, SEASON_MIN_TRACKS)}  # four tracks

    assert countdown_tracks(play_counts(counts), YEAR_START, YEAR_END, LIBRARY) == []


def test_five_tracks_is_a_countdown():
    counts = {f"t{n}": 3 for n in range(1, SEASON_MIN_TRACKS + 1)}

    assert len(countdown_tracks(play_counts(counts), YEAR_START, YEAR_END, LIBRARY)) == SEASON_MIN_TRACKS


def test_plays_outside_the_year_do_not_count():
    # One track played all last year, five played once this year: this year's five, and last year's track is out.
    last_year = play_counts({"t99": 50}, timestamp=YEAR_START - 10)
    this_year = play_counts({f"t{n}": 1 for n in range(1, 6)})

    order = countdown_tracks(last_year + this_year, YEAR_START, YEAR_END, LIBRARY | {"t99"})

    assert "t99" not in order
    assert sorted(order) == [f"t{n}" for n in range(1, 6)]


def test_the_window_includes_its_first_second_and_excludes_the_first_second_after_it():
    # [start, end): the first second of the year counts, the first second of the next does not.
    first = [Play(f"t{n}", YEAR_START) for n in range(1, 5)]
    last_second = [Play("t5", YEAR_END - 1)]
    next_year = [Play("t6", YEAR_END)]

    order = countdown_tracks(first + last_second + next_year, YEAR_START, YEAR_END, LIBRARY)

    assert sorted(order) == ["t1", "t2", "t3", "t4", "t5"]


def test_a_track_that_left_the_library_is_not_in_the_countdown_nor_counts_to_the_minimum():
    # Four library tracks and one that is gone: the gone one is the favourite, and it does not make five.
    counts = {"gone": 100, "t1": 9, "t2": 8, "t3": 7, "t4": 6}

    assert countdown_tracks(play_counts(counts), YEAR_START, YEAR_END, LIBRARY) == []


@pytest.mark.parametrize(
    ("today", "year"),
    [
        (date(2026, 12, 31), 2026),  # New Year's Eve: this year
        (date(2027, 1, 1), 2026),  # 1 January: the year that just ended
        (date(2027, 1, 2), 2027),  # back to this year
        (date(2026, 12, 1), 2026),
    ],
)
def test_the_countdown_year_is_this_year_except_on_the_first_of_january(today, year):
    assert countdown_year(today) == year


# --- Where a season's station goes -----------------------------------------


@pytest.mark.parametrize(
    ("season", "station"),
    [("christmas", "christmas"), ("newyear", "countdown"), ("bogus", None), ("", None), (None, None)],
)
def test_a_season_maps_to_its_station_and_anything_else_to_none(season, station):
    assert season_station_id(season) == station


def seasonal(*ids: str) -> dict[str, dict[str, object]]:
    names = {"christmas": ("season", "Christmas"), "countdown": ("season", "Countdown")}
    return {i: {"kind": names[i][0], "name": names[i][1]} for i in ids}


def test_the_christmas_station_comes_first_at_christmas_and_the_countdown_first_at_new_year():
    stations = {
        **seasonal("christmas", "countdown"),
        "genre1": {"kind": "genre", "name": "rock"},
        "decade1": {"kind": "decade", "name": "1990s"},
    }

    at_christmas = station_listing([], stations, season="christmas")
    at_new_year = station_listing([], stations, season="newyear")

    assert [s["id"] for s in at_christmas] == ["christmas", "genre1", "decade1"]
    assert at_christmas[0] == {"id": "christmas", "kind": "season", "name": "Christmas"}
    assert [s["id"] for s in at_new_year] == ["countdown", "genre1", "decade1"]
    assert at_new_year[0] == {"id": "countdown", "kind": "season", "name": "Countdown"}


def test_an_unknown_season_is_ignored_and_no_season_lists_the_usual_stations():
    stations = {**seasonal("christmas", "countdown"), "genre1": {"kind": "genre", "name": "rock"}}

    for season in ["bogus", "halloween", None]:
        assert [s["id"] for s in station_listing([], stations, season=season)] == ["genre1"]


def test_a_season_with_no_station_in_the_store_lists_nothing_for_it():
    # The user has no Christmas station (too few tracks): the Christmas season has none to put first.
    stations = {"genre1": {"kind": "genre", "name": "rock"}}

    assert [s["id"] for s in station_listing([], stations, season="christmas")] == ["genre1"]


def test_the_season_station_is_listed_only_for_its_own_season():
    stations = seasonal("christmas")

    assert [s["id"] for s in station_listing([], stations, season="newyear")] == []


# --- The station as the routine builds it ----------------------------------


def christmas_library(n: int) -> list[tuple[str, str]]:
    return [(f"c{i}", f"ca{i % 3}") for i in range(n)]


def test_a_christmas_station_needs_five_library_tracks():
    plays = [Play("c0", YEAR_START + 5), Play("c1", YEAR_START + 5)]

    assert build_season_stations(christmas_library(4), plays, LIBRARY, NOW, 1, YEAR_START, YEAR_END) == []


def test_the_christmas_station_is_drawn_from_the_christmas_pool_only():
    pool = christmas_library(10)
    plays = [Play("c0", NOW - 86400)]

    stations = build_season_stations(pool, plays, LIBRARY, NOW, 1, YEAR_START, YEAR_END)
    (christmas,) = [s for s in stations if s.key == "christmas"]

    assert christmas.kind == "season"
    assert christmas.name == "Christmas"
    assert christmas.tracks and set(christmas.tracks) <= {t for t, _ in pool}


def test_the_countdown_station_is_built_from_the_year_and_is_not_shuffled():
    # Seven tracks, track n with n plays: fewer than thirty, so all seven, from #7 to #1 in
    # the order given: the favourite last, exactly, not a draw.
    counts = {f"t{n}": n for n in range(1, 8)}
    stations = build_season_stations([], play_counts(counts), LIBRARY, NOW, 1, YEAR_START, YEAR_END)

    (countdown,) = stations
    assert isinstance(countdown, Station)
    assert countdown.kind == "season"
    assert countdown.key == "countdown"
    assert countdown.name == "Countdown"
    assert countdown.tracks == [f"t{n}" for n in range(1, 8)]
