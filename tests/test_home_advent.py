"""
The Advent calendar's rules (`lib/home/advent.py`): which days have a door,
which album sits behind each door, and what stays put once a door is decided.

No database or store code, so these run in the fast lane.
"""

from datetime import date

from aivinnet.lib.home.advent import (
    ADVENT_DAYS,
    DAY,
    QUIET_DAYS,
    AdventAlbum,
    advent_day,
    advent_order,
    advent_picks,
)

NOW = 1_790_000_000.0
ARTIST = "artist"


def album(n: int, plays: int = 0, last_played: int = 0, artists: tuple[str, ...] = (ARTIST,)) -> AdventAlbum:
    return AdventAlbum(albumhash=f"album{n:02}", artists=artists, plays=plays, last_played=last_played)


def quiet(n: int) -> AdventAlbum:
    return album(n, plays=4, last_played=int(NOW - (QUIET_DAYS + 30) * DAY))


def never(n: int) -> AdventAlbum:
    return album(n)


def recent(n: int) -> AdventAlbum:
    return album(n, plays=2, last_played=int(NOW - 10 * DAY))


def library(n: int) -> list[AdventAlbum]:
    return [album(i, plays=(i % 3) * 2, last_played=int(NOW - 40 * DAY) if i % 3 else 0) for i in range(n)]


class TestAdventDay:
    def test_the_doors_are_december_first_to_twenty_fourth(self):
        assert advent_day(date(2026, 12, 1)) == 1
        assert advent_day(date(2026, 12, 5)) == 5
        assert advent_day(date(2026, 12, ADVENT_DAYS)) == ADVENT_DAYS

    def test_outside_the_window_there_is_no_calendar(self):
        assert advent_day(date(2026, 11, 30)) == 0
        assert advent_day(date(2026, 12, 25)) == 0
        assert advent_day(date(2026, 12, 31)) == 0
        assert advent_day(date(2027, 1, 1)) == 0
        assert advent_day(date(2026, 6, 15)) == 0

    def test_the_same_day_number_in_another_month_is_no_door(self):
        assert advent_day(date(2026, 11, 5)) == 0


class TestOrder:
    def test_quiet_albums_come_first_then_never_played_then_the_rest(self):
        albums = [recent(1), never(2), quiet(3), recent(4), never(5), quiet(6)]

        order = advent_order(albums, userid=1, year=2026, now=NOW)

        assert set(order[:2]) == {"album03", "album06"}
        assert set(order[2:4]) == {"album02", "album05"}
        assert order[4:] == ["album01", "album04"]  # least recently played first

    def test_placeholder_artists_are_no_door(self):
        albums = [never(1), album(2, artists=("unknown",)), album(3, artists=())]

        order = advent_order(albums, 1, 2026, NOW, skip=lambda artisthash: artisthash == "unknown")

        assert order == ["album01"]

    def test_the_order_is_stable_for_a_user_and_a_year(self):
        albums = [never(n) for n in range(40)]

        first = advent_order(albums, userid=1, year=2026, now=NOW)

        assert advent_order(albums, userid=1, year=2026, now=NOW) == first
        assert advent_order(albums, userid=2, year=2026, now=NOW) != first
        assert advent_order(albums, userid=1, year=2027, now=NOW) != first


class TestPicks:
    def test_the_same_inputs_give_the_same_calendar(self):
        albums = library(40)

        first = advent_picks(albums, userid=1, year=2026, day=ADVENT_DAYS, now=NOW)
        second = advent_picks(albums, userid=1, year=2026, day=ADVENT_DAYS, now=NOW)

        assert first == second
        assert sorted(first) == list(range(1, ADVENT_DAYS + 1))

    def test_no_album_twice_while_the_library_has_one_left(self):
        picks = advent_picks(library(40), userid=1, year=2026, day=ADVENT_DAYS, now=NOW)

        assert len(set(picks.values())) == ADVENT_DAYS

    def test_each_user_and_year_has_its_own_calendar(self):
        albums = [never(n) for n in range(40)]

        picks = advent_picks(albums, userid=1, year=2026, day=ADVENT_DAYS, now=NOW)

        assert picks != advent_picks(albums, userid=2, year=2026, day=ADVENT_DAYS, now=NOW)
        assert picks != advent_picks(albums, userid=1, year=2027, day=ADVENT_DAYS, now=NOW)

    def test_the_doors_draw_quiet_then_never_then_recent(self):
        albums = [quiet(n) for n in range(5)] + [never(n) for n in range(5, 35)] + [recent(n) for n in range(35, 40)]
        quiet_hashes = {a.albumhash for a in albums[:5]}
        never_hashes = {a.albumhash for a in albums[5:35]}

        picks = advent_picks(albums, userid=1, year=2026, day=ADVENT_DAYS, now=NOW)

        assert {picks[d] for d in range(1, 6)} == quiet_hashes
        assert all(picks[d] in never_hashes for d in range(6, 25))

    def test_fewer_albums_than_days_repeat_only_then(self):
        albums = [never(n) for n in range(5)]

        picks = advent_picks(albums, userid=1, year=2026, day=ADVENT_DAYS, now=NOW)

        assert len(picks) == ADVENT_DAYS
        assert set(picks.values()) == {a.albumhash for a in albums}
        # Once every album has had its door, the order starts over.
        assert picks[6] == picks[1]

    def test_a_day_is_not_repeated_while_others_are_free(self):
        albums = [never(n) for n in range(30)]

        picks = advent_picks(albums, userid=1, year=2026, day=10, now=NOW)

        assert len(set(picks.values())) == 10

    def test_only_the_days_so_far_have_doors(self):
        picks = advent_picks(library(40), userid=1, year=2026, day=3, now=NOW)

        assert sorted(picks) == [1, 2, 3]

    def test_an_empty_library_has_no_doors(self):
        assert advent_picks([], userid=1, year=2026, day=5, now=NOW) == {}

    def test_a_decided_door_keeps_its_album_when_plays_move_the_order(self):
        # Door 1 was opened today, and the album played now sits in the recent tier.
        albums = [never(n) for n in range(10)]
        decided = advent_picks(albums, userid=1, year=2026, day=2, now=NOW)

        played = [
            AdventAlbum(
                albumhash=a.albumhash,
                artists=a.artists,
                plays=1 if a.albumhash == decided[1] else 0,
                last_played=int(NOW) if a.albumhash == decided[1] else 0,
            )
            for a in albums
        ]
        later = advent_picks(played, userid=1, year=2026, day=5, now=NOW, made=decided)

        assert later[1] == decided[1]
        assert later[2] == decided[2]
        assert len(set(later.values())) == 5
