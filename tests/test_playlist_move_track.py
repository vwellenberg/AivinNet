"""
Tests for safe single-track moves and the reorder permutation guard.

Regression cover for a data-loss bug: `PUT /playlists/<id>/reorder` replaced the
stored trackhash list with whatever the client sent, and the web client sent only
the tracks it had paginated in (never orphan hashes). Measured on a live server,
one drag in a 120-track playlist cut it down to 44 tracks.
"""

import pytest

from aivinnet.lib.playlist_maintenance import (
    TrackhashNotInPlaylist,
    move_trackhash,
    remove_trackhashes,
    trackhash_diff,
)


class TestMoveTrackhash:
    def test_moves_down(self):
        assert move_trackhash(["a", "b", "c", "d"], "a", "d") == ["b", "c", "a", "d"]

    def test_moves_up(self):
        assert move_trackhash(["a", "b", "c", "d"], "d", "b") == ["a", "d", "b", "c"]

    def test_moves_to_the_very_top(self):
        assert move_trackhash(["a", "b", "c"], "c", "a") == ["c", "a", "b"]

    def test_none_anchor_moves_to_the_end(self):
        assert move_trackhash(["a", "b", "c"], "a", None) == ["b", "c", "a"]

    def test_moving_the_last_track_to_the_end_is_a_noop(self):
        assert move_trackhash(["a", "b", "c"], "c", None) == ["a", "b", "c"]

    def test_moving_in_front_of_itself_is_a_noop(self):
        assert move_trackhash(["a", "b", "c"], "b", "b") == ["a", "b", "c"]

    def test_moving_in_front_of_the_next_track_is_a_noop(self):
        assert move_trackhash(["a", "b", "c"], "a", "b") == ["a", "b", "c"]

    def test_single_element_list(self):
        assert move_trackhash(["a"], "a", None) == ["a"]

    def test_does_not_mutate_the_input(self):
        stored = ["a", "b", "c"]
        move_trackhash(stored, "a", None)
        assert stored == ["a", "b", "c"]

    # --- the whole point of the anchor design ------------------------------

    def test_preserves_unresolvable_orphan_hashes(self):
        # "orphan" resolves to no track, so the client never sees it and could
        # never include it in a full-list submit.
        stored = ["orphan", "a", "b", "c"]
        assert move_trackhash(stored, "a", "c") == ["orphan", "b", "a", "c"]

    def test_orphans_between_the_anchors_keep_their_slot(self):
        stored = ["a", "orphan", "b", "c"]
        assert move_trackhash(stored, "c", "b") == ["a", "orphan", "c", "b"]

    def test_track_count_never_changes(self):
        stored = [f"h{i}" for i in range(120)]
        moved = move_trackhash(stored, "h0", "h4")
        assert len(moved) == 120
        assert sorted(moved) == sorted(stored)

    # --- error cases -------------------------------------------------------

    def test_unknown_trackhash_raises(self):
        with pytest.raises(TrackhashNotInPlaylist):
            move_trackhash(["a", "b"], "nope", "a")

    def test_unknown_anchor_raises(self):
        with pytest.raises(TrackhashNotInPlaylist):
            move_trackhash(["a", "b"], "a", "nope")

    def test_error_names_the_offending_role(self):
        with pytest.raises(TrackhashNotInPlaylist) as e:
            move_trackhash(["a", "b"], "a", "nope")
        assert e.value.role == "before_trackhash"
        assert e.value.trackhash == "nope"


class TestTrackhashDiff:
    def test_permutation_reports_no_difference(self):
        assert trackhash_diff(["c", "a", "b"], ["a", "b", "c"]) == ([], [])

    def test_identical_lists_report_no_difference(self):
        assert trackhash_diff(["a", "b"], ["a", "b"]) == ([], [])

    def test_reports_dropped_hashes(self):
        dropped, added = trackhash_diff(["a", "b"], ["a", "b", "c", "d"])
        assert dropped == ["c", "d"]
        assert added == []

    def test_reports_added_hashes(self):
        dropped, added = trackhash_diff(["a", "b", "x"], ["a", "b"])
        assert dropped == []
        assert added == ["x"]

    def test_compares_as_multisets_not_sets(self):
        # Losing one of two duplicates is still a loss.
        dropped, added = trackhash_diff(["a"], ["a", "a"])
        assert dropped == ["a"]
        assert added == []

    def test_a_paginated_client_submit_is_detected_as_a_loss(self):
        stored = [f"h{i}" for i in range(120)]
        paginated = stored[:38]
        dropped, added = trackhash_diff(paginated, stored)
        assert len(dropped) == 82
        assert added == []


class TestRemoveTrackhashes:
    def test_removes_by_hash(self):
        assert remove_trackhashes(["a", "b", "c"], [{"trackhash": "b", "index": 1}]) == ["a", "c"]

    def test_removes_even_when_the_index_hint_is_stale(self):
        # THE BUG: the client index counts RESOLVED tracks, the stored list also
        # holds orphans -> the old `index()==index` guard silently removed nothing
        # while still answering 200/"Done".
        # Stored ["orphan", "a", "b", "c"] resolves to ["a", "b", "c"], so the
        # client sends index 1 for "b" while its stored index is 2.
        stored = ["orphan", "a", "b", "c"]
        assert remove_trackhashes(stored, [{"trackhash": "b", "index": 1}]) == ["orphan", "a", "c"]

    def test_orphan_shifted_index_hint_never_picks_the_wrong_track(self):
        # The stale hint must not be trusted as a position either: index 1 points
        # at "a" in the stored list, but the client meant "b".
        stored = ["orphan", "a", "b", "c"]
        result = remove_trackhashes(stored, [{"trackhash": "b", "index": 1}])
        assert "a" in result

    def test_removes_several_tracks(self):
        stored = ["a", "b", "c", "d"]
        items = [{"trackhash": "b", "index": 1}, {"trackhash": "d", "index": 3}]
        assert remove_trackhashes(stored, items) == ["a", "c"]

    def test_index_hint_picks_the_right_duplicate(self):
        stored = ["a", "dup", "b", "dup"]
        assert remove_trackhashes(stored, [{"trackhash": "dup", "index": 3}]) == ["a", "dup", "b"]

    def test_unknown_hash_is_skipped(self):
        assert remove_trackhashes(["a", "b"], [{"trackhash": "nope", "index": 0}]) == ["a", "b"]

    def test_missing_index_still_removes(self):
        assert remove_trackhashes(["a", "b"], [{"trackhash": "a"}]) == ["b"]

    def test_does_not_mutate_the_input(self):
        stored = ["a", "b"]
        remove_trackhashes(stored, [{"trackhash": "a", "index": 0}])
        assert stored == ["a", "b"]
