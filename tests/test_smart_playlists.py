"""Rules of smart playlists: parsing, every field and operator, match modes, limit and sort.

Pure: the rules module imports nothing from the app, so this runs in the fast lane.
"""

import pytest

from aivinnet.lib.smart_playlists import (
    DEFAULT_LIMIT,
    DEFAULT_SORT,
    MAX_LIMIT,
    SECONDS_PER_DAY,
    Definition,
    Rule,
    Sort,
    TrackFacts,
    definition_to_json,
    evaluate,
    parse_definition,
)

NOW = 1_800_000_000  # a fixed moment, so "in the last N days" is reproducible
DAY = SECONDS_PER_DAY


def track(trackhash: str, title: str = "", **overrides) -> TrackFacts:
    base = dict(
        trackhash=trackhash,
        title=title or trackhash,
        genres=("rock",),
        artists=("Primus",),
        albumartists=("Primus",),
        year=1991,
        added=NOW - 400 * DAY,
        playcount=0,
        last_played=None,
        favorite=False,
    )
    base.update(overrides)
    return TrackFacts(**base)


def definition(*rules: dict, match: str = "all", limit: int | None = None, sort=None) -> Definition:
    raw: dict = {"match": match, "rules": list(rules)}
    if limit is not None:
        raw["limit"] = limit
    if sort is not None:
        raw["sort"] = sort
    return parse_definition(raw)


def run(defn: Definition, *tracks: TrackFacts, seed: str = "") -> list[str]:
    return evaluate(defn, list(tracks), NOW, seed=seed)


# ---------------------------------------------------------------- parsing


class TestParsing:
    def test_defaults_are_all_100_newest_first(self):
        defn = parse_definition({"rules": [{"field": "favorite", "op": "is", "value": True}]})

        assert defn.match == "all"
        assert defn.limit == DEFAULT_LIMIT == 100
        assert defn.sort == DEFAULT_SORT
        assert defn.sort == Sort("date_added", descending=True)

    def test_round_trips_through_its_stored_json(self):
        defn = definition(
            {"field": "year", "op": "between", "value": [1990, 1999]},
            {"field": "last_played", "op": "never"},
            match="any",
            limit=25,
            sort={"field": "playcount", "order": "desc"},
        )

        stored = definition_to_json(defn)

        assert parse_definition(stored) == defn
        assert stored["rules"][0]["value"] == [1990, 1999]  # a tuple is stored as a list

    @pytest.mark.parametrize(
        ("raw", "message"),
        [
            ({"rules": []}, "at least one rule"),
            ({"rules": "favorite"}, "rules must be a list"),
            (
                {"match": "some", "rules": [{"field": "favorite", "op": "is", "value": True}]},
                'match must be "all" or "any"',
            ),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "sorting": "random"}, "unknown key"),
            ({"rules": [{"field": "mood", "op": "is", "value": "x"}]}, "unknown field 'mood'"),
            ({"rules": [{"field": ["genre"], "op": "is", "value": "x"}]}, "unknown field"),
            ({"rules": [{"field": "genre", "op": "eq", "value": "x"}]}, "genre takes is, is_not, contains"),
            ({"rules": [{"field": "genre", "op": "is", "value": "   "}]}, "non-empty text"),
            ({"rules": [{"field": "genre", "op": "is", "value": 7}]}, "non-empty text"),
            ({"rules": [{"field": "year", "op": "eq", "value": "1991"}]}, "whole number"),
            ({"rules": [{"field": "playcount", "op": "gt", "value": True}]}, "whole number"),
            ({"rules": [{"field": "playcount", "op": "gt", "value": -1}]}, "whole number"),
            ({"rules": [{"field": "year", "op": "between", "value": [1990]}]}, "[low, high]"),
            ({"rules": [{"field": "year", "op": "between", "value": [2000, 1990]}]}, "is above high"),
            ({"rules": [{"field": "favorite", "op": "is", "value": "yes"}]}, "true or false"),
            ({"rules": [{"field": "last_played", "op": "never", "value": 3}]}, "takes no value"),
            ({"rules": [{"field": "date_added", "op": "never"}]}, "takes in_last_days"),
            ({"rules": [{"field": "last_played", "op": "in_last_days", "value": 0}]}, "at least 1"),
            ({"rules": [{"field": "last_played", "op": "in_last_days", "value": 2.5}]}, "whole number of days"),
            ({"rules": ["favorite"]}, "must be an object"),
            ({"rules": [{"field": "favorite", "op": "is", "value": True, "x": 1}]}, "unknown key"),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "limit": 0}, "from 1 to 1000"),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "limit": MAX_LIMIT + 1}, "from 1 to 1000"),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "limit": True}, "from 1 to 1000"),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "sort": "shuffle"}, "sort must be"),
            (
                {
                    "rules": [{"field": "favorite", "op": "is", "value": True}],
                    "sort": {"field": "mood", "order": "asc"},
                },
                "sort field",
            ),
            (
                {"rules": [{"field": "favorite", "op": "is", "value": True}], "sort": {"field": "year", "order": "up"}},
                "asc",
            ),
            ({"rules": [{"field": "favorite", "op": "is", "value": True}], "sort": {"field": "year"}}, "asc"),
        ],
    )
    def test_refuses_a_bad_definition_with_a_message(self, raw, message):
        with pytest.raises(ValueError, match=message):
            parse_definition(raw)

    def test_the_limit_bounds_are_inclusive(self):
        favorite = {"field": "favorite", "op": "is", "value": True}

        assert parse_definition({"rules": [favorite], "limit": 1}).limit == 1
        assert parse_definition({"rules": [favorite], "limit": MAX_LIMIT}).limit == MAX_LIMIT

    def test_random_sort_takes_the_bare_word(self):
        defn = definition({"field": "favorite", "op": "is", "value": True}, sort="random")

        assert defn.sort.random


# ------------------------------------------------------- string fields


class TestTextFields:
    LIBRARY = [
        track("a", genres=("Rock", "Psychedelic"), artists=("Primus",), albumartists=("Primus",)),
        track("b", genres=("Jazz",), artists=("Miles Davis",), albumartists=("Various Artists",)),
        track("c", genres=(), artists=("Pink Floyd", "Roger Waters"), albumartists=("Pink Floyd",)),
    ]

    @pytest.mark.parametrize(
        ("field", "op", "value", "expected"),
        [
            ("genre", "is", "rock", ["a"]),  # case-insensitive, and any of several genres
            ("genre", "is", "Psychedelic", ["a"]),
            ("genre", "is", "rock jazz", []),  # no partial match for "is"
            ("genre", "is_not", "rock", ["b", "c"]),  # a track without genres counts as not rock
            ("genre", "contains", "az", ["b"]),
            ("artist", "is", "roger waters", ["c"]),  # any of the track's artists
            ("artist", "contains", "davis", ["b"]),
            ("artist", "is_not", "primus", ["b", "c"]),
            ("albumartist", "is", "pink floyd", ["c"]),
            ("albumartist", "contains", "various", ["b"]),
            ("albumartist", "is_not", "pink floyd", ["a", "b"]),
        ],
    )
    def test_each_operator(self, field, op, value, expected):
        defn = definition({"field": field, "op": op, "value": value})

        assert sorted(run(defn, *self.LIBRARY)) == sorted(expected)


# ------------------------------------------------------ numeric fields


class TestNumberFields:
    LIBRARY = [
        track("old", year=1968, playcount=2),
        track("nineties", year=1995, playcount=40),
        track("late", year=2003, playcount=7),
        track("no_year", year=None, playcount=0),
    ]

    @pytest.mark.parametrize(
        ("field", "op", "value", "expected"),
        [
            ("year", "eq", 1995, ["nineties"]),
            ("year", "lt", 1990, ["old"]),
            ("year", "gt", 1990, ["nineties", "late"]),  # a track without a year matches none
            ("year", "between", [1990, 1999], ["nineties"]),
            ("year", "between", (1968, 1995), ["old", "nineties"]),  # both ends inclusive
            ("playcount", "eq", 0, ["no_year"]),
            ("playcount", "lt", 7, ["old", "no_year"]),
            ("playcount", "gt", 7, ["nineties"]),
            ("playcount", "between", [2, 7], ["old", "late"]),
        ],
    )
    def test_each_operator(self, field, op, value, expected):
        defn = definition({"field": field, "op": op, "value": value})

        assert sorted(run(defn, *self.LIBRARY)) == sorted(expected)


# ------------------------------------------------------- date fields


class TestDateFields:
    LIBRARY = [
        track("fresh", added=NOW - 2 * DAY, last_played=NOW - 1 * DAY, playcount=3),
        track("month", added=NOW - 20 * DAY, last_played=NOW - 25 * DAY, playcount=1),
        track("never", added=NOW - 100 * DAY, last_played=None),
        track("ancient", added=NOW - 900 * DAY, last_played=NOW - 800 * DAY),
    ]

    @pytest.mark.parametrize(
        ("field", "op", "value", "expected"),
        [
            ("date_added", "in_last_days", 30, ["fresh", "month"]),
            ("date_added", "not_in_last_days", 30, ["never", "ancient"]),
            ("date_added", "in_last_days", 1, []),
            ("last_played", "in_last_days", 7, ["fresh"]),
            ("last_played", "in_last_days", 30, ["fresh", "month"]),
            # Never played has no last play: it is not in the last N days,
            # so `not_in_last_days` takes it.
            ("last_played", "not_in_last_days", 30, ["never", "ancient"]),
            ("last_played", "never", None, ["never"]),
        ],
    )
    def test_each_operator(self, field, op, value, expected):
        defn = definition({"field": field, "op": op, "value": value})

        assert sorted(run(defn, *self.LIBRARY)) == sorted(expected)

    def test_a_day_boundary_is_inclusive(self):
        edge = track("edge", last_played=NOW - 7 * DAY)
        defn = definition({"field": "last_played", "op": "in_last_days", "value": 7})

        assert run(defn, edge) == ["edge"]


# ---------------------------------------------------- favorite


class TestFavorite:
    def test_is_true_and_is_false(self):
        fav = track("fav", favorite=True)
        other = track("other", favorite=False)

        assert run(definition({"field": "favorite", "op": "is", "value": True}), fav, other) == ["fav"]
        assert run(definition({"field": "favorite", "op": "is", "value": False}), fav, other) == ["other"]


# ------------------------------------------------- all / any


class TestMatchModes:
    LIBRARY = [
        track("rock_90s", genres=("rock",), year=1995),
        track("rock_60s", genres=("rock",), year=1967),
        track("jazz_90s", genres=("jazz",), year=1996),
        track("jazz_60s", genres=("jazz",), year=1962),
    ]
    ROCK = {"field": "genre", "op": "is", "value": "rock"}
    NINETIES = {"field": "year", "op": "between", "value": [1990, 1999]}
    ORDER = {"field": "date_added", "order": "asc"}

    def test_all_needs_every_rule(self):
        defn = definition(self.ROCK, self.NINETIES, match="all", sort=self.ORDER)

        assert run(defn, *self.LIBRARY) == ["rock_90s"]

    def test_any_needs_one_rule(self):
        defn = definition(self.ROCK, self.NINETIES, match="any", sort=self.ORDER)

        assert sorted(run(defn, *self.LIBRARY)) == sorted(["rock_90s", "rock_60s", "jazz_90s"])


# ------------------------------------------------------ limit and sort


class TestLimitAndSort:
    LIBRARY = [
        track("b", "Bravo", playcount=5, added=NOW - 10 * DAY),
        track("a", "Alpha", playcount=5, added=NOW - 30 * DAY),
        track("c", "Charlie", playcount=12, added=NOW - 20 * DAY),
        track("d", "Delta", playcount=0, added=NOW - 40 * DAY),
    ]
    EVERYTHING = {"field": "favorite", "op": "is", "value": False}

    def test_the_limit_cuts_after_sorting(self):
        defn = definition(self.EVERYTHING, limit=2, sort={"field": "playcount", "order": "desc"})

        assert run(defn, *self.LIBRARY) == ["c", "a"]  # ties on 5 go by title: Alpha before Bravo

    def test_playcount_descending_and_ascending(self):
        desc = definition(self.EVERYTHING, sort={"field": "playcount", "order": "desc"})
        asc = definition(self.EVERYTHING, sort={"field": "playcount", "order": "asc"})

        assert run(desc, *self.LIBRARY) == ["c", "a", "b", "d"]
        assert run(asc, *self.LIBRARY) == ["d", "a", "b", "c"]

    def test_title_ties_keep_title_order_in_both_directions(self):
        same = [track("y", "Same", playcount=3), track("x", "Same", playcount=3)]
        desc = definition(self.EVERYTHING, sort={"field": "playcount", "order": "desc"})

        assert run(desc, *same) == ["x", "y"]

    def test_default_sort_is_newest_added_first(self):
        defn = definition(self.EVERYTHING)

        assert run(defn, *self.LIBRARY) == ["b", "c", "a", "d"]

    def test_missing_values_go_last_in_either_direction(self):
        library = [
            track("played_long_ago", last_played=NOW - 300 * DAY),
            track("never", last_played=None),
            track("played_recently", last_played=NOW - 1 * DAY),
        ]

        for order in ("asc", "desc"):
            defn = definition(self.EVERYTHING, sort={"field": "last_played", "order": order})
            result = run(defn, *library)
            assert result[-1] == "never", order

    def test_year_sort_puts_tracks_without_a_year_last(self):
        library = [track("unknown", year=None), track("y1970", year=1970), track("y1960", year=1960)]
        defn = definition(self.EVERYTHING, sort={"field": "year", "order": "asc"})

        assert run(defn, *library) == ["y1960", "y1970", "unknown"]

    def test_text_sort_is_case_insensitive(self):
        library = [track("z", genres=("zydeco",)), track("a", genres=("Afrobeat",)), track("m", genres=("metal",))]
        defn = definition(self.EVERYTHING, sort={"field": "genre", "order": "asc"})

        assert run(defn, *library) == ["a", "m", "z"]

    def test_random_is_reproducible_for_one_seed(self):
        library = [track(f"t{i:02d}") for i in range(30)]
        defn = definition(self.EVERYTHING, limit=30, sort="random")

        first = run(defn, *library, seed="playlist-7:2027-01-15")
        again = run(defn, *library, seed="playlist-7:2027-01-15")

        assert first == again
        assert sorted(first) == sorted(t.trackhash for t in library)

    def test_random_does_not_depend_on_the_input_order(self):
        library = [track(f"t{i:02d}") for i in range(30)]
        defn = definition(self.EVERYTHING, limit=30, sort="random")

        assert run(defn, *library, seed="s") == run(defn, *reversed(library), seed="s")

    def test_random_takes_its_limit_from_all_matches(self):
        library = [track(f"t{i:02d}") for i in range(30)]
        defn = definition(self.EVERYTHING, limit=5, sort="random")

        result = run(defn, *library, seed="s")

        assert len(result) == 5
        assert len(set(result)) == 5

    def test_random_differs_between_seeds(self):
        library = [track(f"t{i:02d}") for i in range(30)]
        defn = definition(self.EVERYTHING, limit=30, sort="random")

        assert run(defn, *library, seed="one") != run(defn, *library, seed="two")

    def test_an_empty_library_or_no_match_is_an_empty_list(self):
        defn = definition({"field": "favorite", "op": "is", "value": True})

        assert run(defn) == []
        assert run(defn, track("plain", favorite=False)) == []


def test_rule_and_sort_are_plain_values():
    """The dataclasses compare by value: what is stored and what is parsed are the same thing."""
    assert Rule("favorite", "is", True) == Rule(field="favorite", op="is", value=True)
    assert Sort("year", descending=False) == Sort(field="year")
