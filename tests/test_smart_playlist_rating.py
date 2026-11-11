"""The `rating` rule of smart playlists (#777), pure logic.

`gte`, `lte` and `eq` take a whole number from 1 to 5; `unrated` takes no value
and matches a track this user has not rated. A track the user has not rated
has no rating at all, so `gte 1` does not match it.
"""

import pytest

from aivinnet.lib.smart_playlists import TrackFacts, evaluate, parse_definition

NOW = 1_800_000_000


def _track(trackhash: str, rating: int | None) -> TrackFacts:
    return TrackFacts(
        trackhash=trackhash,
        title=trackhash,
        genres=(),
        artists=("Artist",),
        albumartists=("Artist",),
        year=None,
        added=NOW,
        playcount=0,
        last_played=None,
        favorite=False,
        rating=rating,
    )


LIBRARY = [_track("five", 5), _track("four", 4), _track("one", 1), _track("none", None)]


def _run(op: str, value=None) -> list[str]:
    rule = {"field": "rating", "op": op}
    if value is not None:
        rule["value"] = value
    defn = parse_definition({"rules": [rule], "sort": {"field": "rating", "order": "desc"}})
    return evaluate(defn, LIBRARY, NOW)


@pytest.mark.parametrize(
    ("op", "value", "expected"),
    [
        ("gte", 4, ["five", "four"]),
        ("lte", 1, ["one"]),
        ("eq", 4, ["four"]),
        ("gte", 1, ["five", "four", "one"]),
    ],
)
def test_a_numeric_rating_rule_matches_only_rated_tracks_in_range(op, value, expected):
    assert _run(op, value) == expected


def test_unrated_matches_only_tracks_without_a_rating():
    assert _run("unrated") == ["none"]


@pytest.mark.parametrize("bad", [0, 6, -1, True, "4", 4.5, None])
def test_a_rating_value_outside_one_to_five_is_refused(bad):
    with pytest.raises(ValueError):
        parse_definition({"rules": [{"field": "rating", "op": "gte", "value": bad}]})


def test_unrated_takes_no_value():
    with pytest.raises(ValueError):
        parse_definition({"rules": [{"field": "rating", "op": "unrated", "value": 3}]})


def test_an_unknown_rating_operator_is_refused():
    with pytest.raises(ValueError):
        parse_definition({"rules": [{"field": "rating", "op": "between", "value": [1, 5]}]})


def test_rating_can_be_a_sort_key_with_unrated_last():
    defn = parse_definition(
        {"rules": [{"field": "rating", "op": "unrated"}], "sort": {"field": "rating", "order": "asc"}}
    )
    assert evaluate(defn, [*LIBRARY, _track("zero", None)], NOW) == ["none", "zero"]
