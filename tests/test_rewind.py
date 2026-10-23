"""
AivinNet Rewind (`lib/rewind.py`, #527): the numbers of one year of listening.

The module imports no database or store code, so these run in the fast lane.
"""

from dataclasses import dataclass
from datetime import UTC, datetime

from aivinnet.lib.home.discover import TrackFacts
from aivinnet.lib.listening_sources import source_kind
from aivinnet.lib.rewind import build_rewind, finished_years

UTC = UTC


@dataclass
class Play:
    trackhash: str
    timestamp: int
    duration: int = 200
    source: str = "al:x"


def at(month: int, day: int, hour: int = 20) -> int:
    return int(datetime(2026, month, day, hour, tzinfo=UTC).timestamp())


def facts(trackhash: str) -> TrackFacts | None:
    """Tracks "<artist>/<album>/<n>"; "va/comp/<n>/<artist>" is a compilation."""
    parts = trackhash.split("/")
    if parts[0] == "gone":
        return None
    if parts[0] == "va":
        return TrackFacts(albumhash="comp", artists=("va",), track_artists=(parts[3],))
    return TrackFacts(albumhash=parts[1], artists=(parts[0],), track_artists=(parts[0],))


def rewind(plays, heard_before=frozenset(), **kw):
    return build_rewind(plays, facts, UTC, set(heard_before), skip=lambda a: a == "va", **kw)


class TestSources:
    def test_each_kind_of_start(self):
        kinds = [source_kind(s) for s in ("al:a1", "pl:3", "pf:2", "ar:x", "fo:/music", "q:blue", "favorite", "")]

        assert kinds == ["album", "playlist", "playlist", "artist", "folder", "search", "favorites", "other"]

    def test_a_generated_playlist_is_home(self):
        assert source_kind("pl:mix1", generated={"mix1", "onrepeat"}) == "home"
        assert source_kind("pl:12", generated={"mix1"}) == "playlist"


class TestFinishedYears:
    def test_a_year_opens_on_new_years_day(self):
        # Plays in 2023 to 2026, now in 2026: 2026 is still running.
        assert finished_years([2023, 2024, 2025, 2026], this_year=2026) == [2023, 2024, 2025]

    def test_a_first_year_still_running_is_none(self):
        assert finished_years([2026], this_year=2026) == []

    def test_only_years_with_music(self):
        # A year without a single play has nothing to look back on.
        assert finished_years([2025, 2019, 2021], this_year=2026) == [2019, 2021, 2025]


class TestRewind:
    def test_the_totals_count_only_tracks_still_in_the_library(self):
        numbers = rewind([Play("rhcp/bss/1", at(3, 1)), Play("gone/x/1", at(3, 1, 21), duration=900)])

        assert numbers["plays"] == 1
        assert numbers["seconds"] == 200
        assert numbers["days"] == 1

    def test_tops_by_time_listened(self):
        plays = [
            Play("rhcp/bss/1", at(1, 5), duration=100),
            Play("rhcp/bss/1", at(1, 6), duration=100),
            Play("fnm/real/1", at(1, 7), duration=500),
        ]

        numbers = rewind(plays)

        assert numbers["top_artists"] == [("fnm", 500), ("rhcp", 200)]
        assert numbers["top_albums"] == [("real", 500), ("bss", 200)]
        # By time, like the charts — the plays ride along.
        assert numbers["top_tracks"] == [("fnm/real/1", 500, 1), ("rhcp/bss/1", 200, 2)]

    def test_a_compilation_counts_for_its_track_artist(self):
        numbers = rewind([Play("va/comp/1/fishbone", at(2, 1))])

        assert numbers["top_artists"] == [("fishbone", 200)]

    def test_the_song_of_the_summer_is_the_most_played_from_june_to_august(self):
        plays = (
            [Play("rhcp/bss/1", at(1, 1))] * 5 + [Play("fnm/real/2", at(7, 10))] * 3 + [Play("primus/ff/1", at(6, 2))]
        )

        assert rewind(plays)["summer_track"] == ("fnm/real/2", 3)

    def test_no_summer_no_song_of_the_summer(self):
        assert rewind([Play("rhcp/bss/1", at(1, 1))])["summer_track"] is None

    def test_the_first_track_of_the_year(self):
        plays = [Play("fnm/real/1", at(1, 3)), Play("rhcp/bss/1", at(1, 1, 0)), Play("gone/x/1", at(1, 1, 0) - 60)]

        # The orphan before it was played but cannot be shown.
        assert rewind(plays)["first_track"] == ("rhcp/bss/1", at(1, 1, 0))

    def test_the_busiest_day(self):
        plays = [Play("rhcp/bss/1", at(5, 4), duration=300)] * 3 + [Play("rhcp/bss/2", at(5, 5), duration=800)]

        assert rewind(plays)["busiest_day"] == ("2026-05-04", 900)

    def test_new_artists_were_never_played_before_the_year(self):
        plays = [Play("rhcp/bss/1", at(1, 1)), Play("tool/lat/1", at(2, 1), duration=900), Play("air/moon/1", at(3, 1))]

        numbers = rewind(plays, heard_before={"rhcp"})

        assert numbers["new_artists"] == 2
        assert numbers["new_artists_top"] == ["tool", "air"]

    def test_the_kind_of_listener_and_the_time_of_day(self):
        plays = [Play("rhcp/bss/1", at(1, d), source="al:bss") for d in range(1, 7)]
        plays += [Play("fnm/real/1", at(2, d, 8), source="pl:3") for d in range(1, 3)]
        plays += [Play("fnm/real/2", at(3, 1), source="")]  # no source: no kind, but still a play

        numbers = rewind(plays)

        # Six of the nine plays — "of your plays", the page says.
        assert numbers["listener"] == {"kind": "album", "share": 0.67}
        assert numbers["time_of_day"] == {"band": "evenings", "share": 0.78}

    def test_only_plays_from_nowhere_name_no_listener(self):
        assert rewind([Play("rhcp/bss/1", at(1, 1), source="")])["listener"] is None

    def test_without_a_zone_days_are_the_c_librarys(self):
        # The listening calendar groups its days in SQLite's `localtime`.
        stamp = at(5, 4, 23)
        numbers = build_rewind([Play("rhcp/bss/1", stamp)], facts, None, set())

        assert numbers["busiest_day"] == (datetime.fromtimestamp(stamp).date().isoformat(), 200)

    def test_an_empty_year(self):
        numbers = rewind([])

        assert numbers["plays"] == 0
        assert numbers["top_tracks"] == []
        assert numbers["first_track"] is None
        assert numbers["busiest_day"] is None
        assert numbers["listener"] is None
        assert numbers["time_of_day"] is None
