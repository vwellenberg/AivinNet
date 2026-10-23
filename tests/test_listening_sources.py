"""
How the user listens (#538): plays per kind of source, their shares and the
tile's words. The same rule names the listener type in Rewind.
"""

from collections import Counter

from aivinnet.lib.listening_sources import (
    KIND_WORDS,
    OTHER,
    SOURCES,
    count_kinds,
    shares_text,
    source_kind,
    source_shares,
)

GENERATED = {"onrepeat", "mix1"}


def test_stored_sources_fold_into_their_kinds():
    kinds = count_kinds(
        [("al:a1", 5), ("al:a2", 3), ("pl:7", 2), ("pl:onrepeat", 4), ("pl:mix1", 1), ("pf:3", 1), ("", 2)],
        GENERATED,
    )

    assert kinds == Counter({"album": 8, "playlist": 3, "home": 5, "other": 2})


def test_shares_are_of_all_plays_and_never_name_other():
    shares = source_shares(Counter({"album": 62, "playlist": 25, "other": 13}))

    # "Other" counts towards the whole, but is no kind of listener.
    assert shares == [("album", 0.62), ("playlist", 0.25)]


def test_a_tie_goes_by_name_whatever_the_order_of_the_plays():
    first = source_shares(Counter({"playlist": 3, "home": 3}))
    second = source_shares(Counter({"home": 3, "playlist": 3}))

    # As Rewind's top lists break ties: "home" before "playlist".
    assert first == second == [("home", 0.5), ("playlist", 0.5)]


def test_only_other_or_nothing_names_no_one():
    assert source_shares(Counter({"other": 9})) == []
    assert source_shares(Counter()) == []


def test_the_tile_names_the_two_largest():
    shares = source_shares(Counter({"album": 62, "playlist": 25, "home": 10, "search": 3}))

    assert shares_text(shares) == "62% albums · 25% playlists"
    assert shares_text(shares[:1]) == "62% albums"
    assert shares_text([("home", 0.4)]) == "40% Home"
    assert shares_text([]) == "—"


def test_a_second_kind_that_rounds_to_nothing_is_left_out():
    shares = source_shares(Counter({"album": 299, "search": 1}))

    assert shares == [("album", 1.0), ("search", 0.0)]
    assert shares_text(shares) == "100% albums"


def test_every_kind_has_a_word():
    # A kind without one would show its internal name on the tile.
    kinds = {kind for _, kind in SOURCES} | {source_kind("q:x"), source_kind("favorite"), source_kind("pl:m", {"m"})}
    assert OTHER not in kinds
    assert kinds <= set(KIND_WORDS)
