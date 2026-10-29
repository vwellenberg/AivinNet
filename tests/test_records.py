"""The pure rules behind the records board (#540) and the milestone plays (#545)."""

from aivinnet.lib.home.discover import SESSION_GAP
from aivinnet.lib.records import (
    CELEBRATED_PLAYS,
    PlayRow,
    board_milestones,
    build_board,
    celebrated,
    longest_session,
    milestones,
    obsession,
)

T0 = 1_790_000_000
DAY = "2026-03-04"


def play(at: int, duration: int = 200, trackhash: str = "t1", day: str = DAY) -> PlayRow:
    return PlayRow(at, duration, trackhash, day)


# --- longest session -------------------------------------------------------


def test_no_plays_no_session():
    assert longest_session([]) is None


def test_a_session_runs_from_its_first_start_to_its_last_end():
    session = longest_session([play(T0, 200), play(T0 + 200, 300)])

    assert session is not None
    assert (session.start, session.end, session.plays) == (T0, T0 + 500, 2)


def test_a_pause_longer_than_the_gap_starts_a_new_session():
    # Start to start, as in "Because you listened": the gap is measured between starts.
    plays = [play(T0, 100), play(T0 + 100 + SESSION_GAP + 1, 100)]

    session = longest_session(plays)

    assert session is not None
    assert session.plays == 1  # both sessions have one play; the first one stands on a tie


def test_a_pause_of_exactly_the_gap_stays_in_the_session():
    plays = [play(T0, 60), play(T0 + SESSION_GAP, 60), play(T0 + SESSION_GAP + 60 + 10_000, 60)]

    session = longest_session(plays)

    assert session is not None
    assert (session.start, session.plays) == (T0, 2)


def test_the_longest_session_wins_not_the_one_with_most_plays():
    short_but_busy = [play(T0 + i * 10, 10) for i in range(20)]  # 200 s, 20 plays
    long_and_slow = [play(T0 + 100_000 + i * 900, 600) for i in range(5)]  # 3,600 s, 5 plays

    session = longest_session(short_but_busy + long_and_slow)

    assert session is not None
    assert (session.start, session.plays) == (T0 + 100_000, 5)


def test_a_tie_keeps_the_earlier_session():
    first = [play(T0, 300)]
    later = [play(T0 + 100_000, 300)]

    session = longest_session(later + first)  # given out of order on purpose

    assert session is not None
    assert session.start == T0


def test_a_long_play_sets_the_end_even_when_a_later_play_ends_earlier():
    session = longest_session([play(T0, 1000), play(T0 + 10, 5)])

    assert session is not None
    assert session.end == T0 + 1000


# --- obsession -------------------------------------------------------------


def test_one_play_a_day_is_no_obsession():
    assert obsession([play(T0, day="2026-03-04"), play(T0 + 1, day="2026-03-05")]) is None


def test_the_track_with_the_most_plays_on_one_day_wins():
    rows = [
        play(T0, trackhash="a", day="2026-03-04"),
        play(T0 + 1, trackhash="a", day="2026-03-04"),
        play(T0 + 2, trackhash="b", day="2026-03-04"),
        play(T0 + 3, trackhash="b", day="2026-03-05"),
        play(T0 + 4, trackhash="b", day="2026-03-06"),
        play(T0 + 5, trackhash="b", day="2026-03-07"),
    ]

    record = obsession(rows)

    assert record is not None
    assert (record.trackhash, record.day, record.plays) == ("a", "2026-03-04", 2)


def test_plays_of_one_track_spread_over_days_are_not_an_obsession():
    rows = [play(T0 + day * 86_400, trackhash="a", day=f"2026-03-0{day + 1}") for day in range(5)]

    assert obsession(rows) is None  # five plays, one a day


def test_a_tie_goes_to_the_earlier_day():
    rows = [
        play(T0, trackhash="a", day="2026-05-02"),
        play(T0 + 1, trackhash="a", day="2026-05-02"),
        play(T0 + 2, trackhash="b", day="2026-04-01"),
        play(T0 + 3, trackhash="b", day="2026-04-01"),
    ]

    record = obsession(rows)

    assert record is not None
    assert record.day == "2026-04-01"


# --- milestones ------------------------------------------------------------


def test_the_board_names_the_first_play_then_every_power_of_ten_reached():
    assert board_milestones(0) == []
    assert board_milestones(1) == [1]
    assert board_milestones(999) == [1]
    assert board_milestones(1_000) == [1, 1_000]
    assert board_milestones(12_345) == [1, 1_000, 10_000]
    assert board_milestones(1_000_000) == [1, 1_000, 10_000, 100_000, 1_000_000]


def test_each_milestone_names_the_play_at_its_number_in_time_order():
    history = [play(T0 + i, trackhash=f"t{i}") for i in range(1_000)]

    rows = milestones(list(reversed(history)))  # not in time order on purpose

    assert [m.number for m in rows] == [1, 1_000]
    assert (rows[0].trackhash, rows[0].timestamp) == ("t0", T0)
    assert (rows[1].trackhash, rows[1].timestamp) == ("t999", T0 + 999)


# --- celebrated plays (#545) -----------------------------------------------


def test_the_easter_egg_celebrates_the_round_plays_and_1337():
    assert {1_000, 1_337, 10_000, 100_000} == CELEBRATED_PLAYS
    for count in (1_000, 1_337, 10_000, 100_000):
        assert celebrated(count)
    for count in (1, 999, 1_001, 1_336, 1_338, 9_999, 10_001, 100_001):
        assert not celebrated(count)


def test_each_milestone_fires_exactly_once_per_user():
    # The count of a user's plays only grows by one per play: every number is
    # reached once, so the celebrated numbers come up once each.
    hits = [count for count in range(1, 100_001 + 1) if celebrated(count)]

    assert hits == [1_000, 1_337, 10_000, 100_000]


# --- the whole board ---------------------------------------------------------


def test_the_board_of_an_empty_history_is_empty():
    board = build_board([])

    assert board.plays == 0
    assert board.longest_session is None
    assert board.obsession is None
    assert board.milestones == []


def test_the_board_counts_every_play_including_those_of_removed_tracks():
    rows = [play(T0 + i, trackhash="gone") for i in range(3)]

    board = build_board(rows)

    assert board.plays == 3
    assert board.obsession is not None
    assert board.obsession.trackhash == "gone"
