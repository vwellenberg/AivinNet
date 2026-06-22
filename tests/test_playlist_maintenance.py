"""Tests for the pure playlist trackhash maintenance helpers."""

from swingmusic.lib.playlist_maintenance import merge_trackhashes, prune_orphan_trackhashes


class TestMergeTrackhashes:
    def test_appends_new_at_end_preserving_order(self):
        assert merge_trackhashes(["a", "b", "c"], ["x"]) == ["a", "b", "c", "x"]

    def test_existing_order_is_not_scrambled(self):
        existing = ["h1", "h2", "h3", "h4", "h5"]
        assert merge_trackhashes(existing, ["h6"]) == ["h1", "h2", "h3", "h4", "h5", "h6"]

    def test_appending_existing_hash_is_a_noop(self):
        assert merge_trackhashes(["a", "b", "c"], ["b"]) == ["a", "b", "c"]

    def test_mixes_new_and_existing(self):
        assert merge_trackhashes(["a", "b", "c"], ["b", "y", "a", "z"]) == ["a", "b", "c", "y", "z"]

    def test_dedupes_within_new(self):
        assert merge_trackhashes([], ["x", "x", "y", "x"]) == ["x", "y"]

    def test_empty_existing(self):
        assert merge_trackhashes([], ["a", "b"]) == ["a", "b"]

    def test_empty_new(self):
        assert merge_trackhashes(["a", "b"], []) == ["a", "b"]

    def test_accepts_any_iterable_for_new(self):
        assert merge_trackhashes(["a"], (h for h in ["b", "c"])) == ["a", "b", "c"]


class TestPruneOrphanTrackhashes:
    def test_removes_unresolvable_preserving_order(self):
        trackhashes = ["a", "orphan", "b", "c"]
        resolvable = {"a", "b", "c"}
        assert prune_orphan_trackhashes(trackhashes, resolvable) == ["a", "b", "c"]

    def test_clean_playlist_is_unchanged(self):
        trackhashes = ["a", "b", "c"]
        assert prune_orphan_trackhashes(trackhashes, {"a", "b", "c"}) == ["a", "b", "c"]

    def test_all_orphans_yields_empty(self):
        assert prune_orphan_trackhashes(["x", "y"], {"a"}) == []

    def test_dedupes_survivors(self):
        assert prune_orphan_trackhashes(["a", "a", "b"], {"a", "b"}) == ["a", "b"]

    def test_resolvable_can_be_a_dict_like_trackhashmap(self):
        # The endpoint passes TrackStore.trackhashmap (a dict) directly; `in`
        # checks keys.
        resolvable = {"a": object(), "c": object()}
        assert prune_orphan_trackhashes(["a", "b", "c"], resolvable) == ["a", "c"]

    def test_louis_cole_scenario(self):
        # 8 stored hashes, 1 orphan in the middle -> the exact bug data shape.
        # After prune the 7 resolvable hashes remain in their original order.
        stored = [
            "c3349d56eba64e5b",  # When You're Ugly
            "22a426e863246d63",  # Bank Account
            "a25672d83e31ad73",  # F it Up
            "728eb5b0ff1d75df",  # They Find You
            "b4be318f01de1ef3",  # V
            "a40573c8bda29e99",  # Doing the Things
            "deadbeefdeadbeef",  # <- orphan (no longer in library)
            "6ce880ca4cca6a59",  # Thinking
        ]
        resolvable = set(stored) - {"deadbeefdeadbeef"}
        kept = prune_orphan_trackhashes(stored, resolvable)
        assert kept == [
            "c3349d56eba64e5b",
            "22a426e863246d63",
            "a25672d83e31ad73",
            "728eb5b0ff1d75df",
            "b4be318f01de1ef3",
            "a40573c8bda29e99",
            "6ce880ca4cca6a59",
        ]
        assert len(kept) == 7
