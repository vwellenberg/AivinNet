"""A batch of renames moves its references at once, not pair by pair (#296).

Two swapped titles (A->B, B->A) or a run shifted by one (1->2, 2->3, ...) map a
hash onto one that is itself still being renamed. Pair by pair, the first step
merged two songs into one entry and every later step carried it on.
"""

from aivinnet.lib.reference_migration import (
    playlist_remap_values,
    remap_added_at,
    remap_trackhash_list,
    replace_trackhash_in_list,
)


def _pair_by_pair(trackhashes, mapping):
    for old, new in mapping.items():
        trackhashes = replace_trackhash_in_list(trackhashes, old, new)
    return trackhashes


def test_a_swap_keeps_both_entries_each_following_its_file():
    assert remap_trackhash_list(["a", "x", "b"], {"a": "b", "b": "a"}) == ["b", "x", "a"]
    # What pair by pair did: one entry gone.
    assert len(_pair_by_pair(["a", "x", "b"], {"a": "b", "b": "a"})) == 2


def test_a_shift_moves_every_entry_by_one_place():
    shift = {"t1": "t2", "t2": "t3", "t3": "t4"}

    assert remap_trackhash_list(["t1", "t2", "t3"], shift) == ["t2", "t3", "t4"]
    # Pair by pair, the whole run ended on the last title.
    assert _pair_by_pair(["t1", "t2", "t3"], shift) == ["t4"]


def test_two_old_hashes_landing_on_one_new_collapse_like_a_single_pair():
    assert remap_trackhash_list(["a", "x", "c"], {"a": "n", "c": "n"}) == ["n", "x"]
    assert remap_trackhash_list(["a", "n"], {"a": "n"}) == replace_trackhash_in_list(["a", "n"], "a", "n")


def test_an_intentional_duplicate_of_an_unrelated_track_stays():
    assert remap_trackhash_list(["x", "a", "x"], {"a": "b"}) == ["x", "b", "x"]


def test_added_at_follows_simultaneously_and_the_earlier_date_wins_a_collision():
    assert remap_added_at({"a": 1, "b": 2, "x": 3}, {"a": "b", "b": "a"}) == {"b": 1, "a": 2, "x": 3}
    assert remap_added_at({"a": 5, "c": 3}, {"a": "n", "c": "n"}) == {"n": 3}


def test_an_unaffected_playlist_is_not_rewritten():
    assert playlist_remap_values(["x", "y"], {"added_at": {"x": 1}}, {"a": "b"}) is None
    assert playlist_remap_values(["a"], {"added_at": {"a": 1}, "keep": 1}, {"a": "b"}) == {
        "trackhashes": ["b"],
        "extra": {"added_at": {"b": 1}, "keep": 1},
    }
