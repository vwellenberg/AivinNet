"""
"Your top rated" (`lib/home/toprated.py`, #788): which rated tracks make the
row, in which order, and how many per album.

The module imports no database or store code, so these run in the fast lane.
"""

from dataclasses import dataclass

from aivinnet.lib.home.discover import TrackFacts
from aivinnet.lib.home.toprated import TOP_RATED_ROW_LIMIT, rank_top_rated, top_rated_item

DAY = 86400
NOW = 1_790_000_000


@dataclass
class Play:
    trackhash: str
    timestamp: int


# trackhash -> album, the library as the rules see it
LIBRARY = {
    "t1": "albA",
    "t2": "albA",
    "t3": "albA",
    "t4": "albB",
    "t5": "albC",
    "t6": "albD",
}


def facts_of(trackhash: str) -> TrackFacts | None:
    album = LIBRARY.get(trackhash)
    return TrackFacts(albumhash=album, artists=("artist",)) if album else None


def rank(ratings, plays=(), **kw):
    return rank_top_rated(ratings, plays, facts_of, NOW, **kw)


def test_only_four_and_five_make_the_row():
    got = rank({"t1": 5, "t4": 4, "t5": 3, "t6": 1})
    assert [trackhash for trackhash, _, _ in got] == ["t1", "t4"]


def test_a_never_played_track_comes_first_then_the_longest_unplayed():
    plays = [Play("t4", NOW - 40 * DAY), Play("t5", NOW - 300 * DAY), Play("t5", NOW - 32 * DAY)]
    got = rank({"t4": 5, "t5": 5, "t6": 4}, plays)

    # t6 was never played: oldest of all. t5 last played 300 days ago, but
    # played again 2 days ago, so its last play is the recent one.
    assert [trackhash for trackhash, _, _ in got] == ["t6", "t4", "t5"]
    assert got[0][2] is None
    assert got[1][2] == NOW - 40 * DAY


def test_ties_go_by_higher_rating_then_trackhash():
    got = rank({"t5": 4, "t6": 5, "t4": 4})
    assert [trackhash for trackhash, _, _ in got] == ["t6", "t4", "t5"]


def test_at_most_two_per_album():
    got = rank({"t1": 5, "t2": 5, "t3": 5, "t4": 4})
    assert [trackhash for trackhash, _, _ in got] == ["t1", "t2", "t4"]


def test_tracks_outside_the_library_are_left_out():
    assert rank({"gone": 5, "t4": 4}) == [("t4", 4, None)]


def test_the_row_limit_caps_the_result_and_the_playlist_limit_keeps_more():
    ratings = {f"x{i}": 5 for i in range(40)}
    library = {f"x{i}": f"album{i}" for i in range(40)}

    def wide_facts(trackhash: str) -> TrackFacts | None:
        return TrackFacts(albumhash=library[trackhash], artists=("a",)) if trackhash in library else None

    row = rank_top_rated(ratings, [], wide_facts, NOW)
    assert len(row) == TOP_RATED_ROW_LIMIT == 15
    assert len(rank_top_rated(ratings, [], wide_facts, NOW, limit=100)) == 40


def test_nothing_rated_high_gives_nothing():
    assert rank({}) == []
    assert rank({"t1": 3, "t4": 2}) == []


def test_the_card_says_the_rating_and_the_last_play():
    never = top_rated_item("t1", 5, None)
    assert never == {"type": "track", "hash": "t1", "help_text": "rated 5 · not played yet"}

    played = top_rated_item("t1", 4, NOW)
    assert played["help_text"].startswith("rated 4 · last ")


def test_a_track_heard_lately_is_not_in_the_row():
    """ "Not heard lately": a play inside the quiet window keeps the track out (review of #788)."""
    from aivinnet.lib.home.toprated import TOP_RATED_QUIET_DAYS

    plays = [Play("t4", NOW - DAY), Play("t5", NOW - (TOP_RATED_QUIET_DAYS + 1) * DAY)]

    got = rank({"t4": 5, "t5": 5}, plays)

    assert [t for t, _, _ in got] == ["t5"]
