"""The skip quote (#537): what counts as a skip, a finish, and the two rankings."""

from aivinnet.lib.skip_rate import ALWAYS_SHARE, MIN_PLAYS, TOP, build_skip_rate

LENGTHS = {"a": 200, "b": 200, "c": 100}


def test_a_skip_is_under_thirty_percent_and_the_edge_is_not_one():
    # 59 of 200 seconds is a skip, 60 (exactly 30 %) is not.
    body = build_skip_rate([("a", 59, 1), ("a", 60, 1)], LENGTHS)

    assert body["skipped"] == 1
    assert body["plays"] == 2


def test_a_play_to_the_end_is_at_least_ninety_percent():
    # 180 of 200 is finished; 179 is neither a skip nor finished.
    body = build_skip_rate([("a", 180, MIN_PLAYS)], LENGTHS)
    assert body["to_the_end"][0]["finished"] == MIN_PLAYS

    body = build_skip_rate([("a", 180, MIN_PLAYS), ("a", 179, 1)], LENGTHS)
    assert body["skipped"] == 0
    assert body["to_the_end"] == []  # 5 of 6 finished is under ALWAYS_SHARE


def test_the_middle_counts_as_plays_only():
    body = build_skip_rate([("a", 120, 10)], LENGTHS)

    assert body["plays"] == 10
    assert body["skipped"] == 0
    assert body["most_skipped"] == []
    assert body["to_the_end"] == []


def test_a_listened_length_past_the_end_is_finished():
    body = build_skip_rate([("a", 260, 6)], LENGTHS)

    assert body["to_the_end"] == [{"trackhash": "a", "plays": 6, "finished": 6, "share": 1.0}]


def test_most_skipped_needs_the_minimum_plays():
    # Four plays, all skipped, are not a ranking: one skip of one play is "100 %".
    body = build_skip_rate([("a", 10, MIN_PLAYS - 1)], LENGTHS)
    assert body["most_skipped"] == []

    body = build_skip_rate([("a", 10, MIN_PLAYS)], LENGTHS)
    assert body["most_skipped"] == [{"trackhash": "a", "plays": MIN_PLAYS, "skipped": MIN_PLAYS, "share": 1.0}]


def test_always_to_the_end_needs_the_minimum_plays_too():
    body = build_skip_rate([("b", 200, MIN_PLAYS - 1)], LENGTHS)
    assert body["to_the_end"] == []


def test_most_skipped_ranks_by_share_then_by_skips():
    rows = [
        ("a", 10, 5),  # 5 of 5 skipped
        ("b", 10, 8),  # 8 of 10 skipped
        ("b", 200, 2),
        ("c", 10, 6),  # 6 of 6 skipped
    ]
    body = build_skip_rate(rows, LENGTHS)

    # "a" and "c" are both 100 %; "c" has the more skips. "b" is 80 %.
    assert [row["trackhash"] for row in body["most_skipped"]] == ["c", "a", "b"]
    assert body["most_skipped"][2]["share"] == 0.8


def test_a_tie_in_share_goes_to_the_track_with_more_skips():
    rows = [("a", 10, 5), ("b", 10, 10), ("c", 10, 5)]
    body = build_skip_rate(rows, {"a": 200, "b": 200, "c": 200})

    # "b" has 10 of 10 skips against 5 of 5: both 100 %, the larger count first.
    assert [row["trackhash"] for row in body["most_skipped"]] == ["b", "a", "c"]


def test_lists_are_capped_at_top():
    lengths = {f"t{i}": 100 for i in range(TOP + 3)}
    rows = [(f"t{i}", 10, MIN_PLAYS) for i in range(TOP + 3)]
    body = build_skip_rate(rows, lengths)

    assert len(body["most_skipped"]) == TOP


def test_always_to_the_end_uses_the_share_not_a_count():
    # 9 of 10 finished is exactly ALWAYS_SHARE; 8 of 10 is not.
    rows = [("a", 200, 9), ("a", 10, 1), ("b", 200, 8), ("b", 10, 2)]
    body = build_skip_rate(rows, LENGTHS)

    assert ALWAYS_SHARE == 0.9
    assert [row["trackhash"] for row in body["to_the_end"]] == ["a"]


def test_tracks_missing_from_the_library_are_left_out():
    body = build_skip_rate([("gone", 10, 50), ("a", 200, 1)], LENGTHS)

    assert body["plays"] == 1
    assert body["skipped"] == 0
    assert body["most_skipped"] == []


def test_zero_length_tracks_have_no_share():
    body = build_skip_rate([("z", 0, 9), ("a", 200, 1)], {"z": 0, "a": 200})

    assert body["plays"] == 1
    assert body["most_skipped"] == []


def test_zero_listened_seconds_on_a_real_track_is_a_skip():
    body = build_skip_rate([("a", 0, 5)], LENGTHS)

    assert body["skipped"] == 5


def test_the_overall_rate_is_skips_over_counted_plays():
    rows = [("a", 10, 3), ("a", 200, 1), ("c", 90, 4), ("gone", 10, 100)]
    body = build_skip_rate(rows, LENGTHS)

    # Counted: 3 + 1 + 4 plays; skipped: 3 (the track no longer in the library is not counted).
    assert body["plays"] == 8
    assert body["skipped"] == 3
    assert body["rate"] == 3 / 8


def test_no_counted_play_means_no_rate():
    body = build_skip_rate([("gone", 10, 3)], LENGTHS)

    assert body["rate"] is None
    assert body["plays"] == 0


def test_the_rules_travel_with_the_numbers():
    body = build_skip_rate([], LENGTHS)

    assert body == {
        "plays": 0,
        "skipped": 0,
        "rate": None,
        "most_skipped": [],
        "to_the_end": [],
        "rules": {"skip_below": 0.3, "finished_from": 0.9, "min_plays": MIN_PLAYS, "always": ALWAYS_SHARE},
    }
