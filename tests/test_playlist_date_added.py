"""Tests for the per-track "date added" helpers (playlist added_at map)."""

from swingmusic.lib.playlist_maintenance import prune_added_at, record_added_at


class TestRecordAddedAt:
    def test_records_timestamp_for_new_hashes(self):
        result = record_added_at({}, ["a"], ["a", "b", "c"], 1000)
        assert result == {"b": 1000, "c": 1000}

    def test_keeps_existing_timestamps(self):
        result = record_added_at({"a": 500}, ["a"], ["a", "b"], 1000)
        assert result == {"a": 500, "b": 1000}

    def test_none_map_is_treated_as_empty(self):
        result = record_added_at(None, [], ["a"], 1000)
        assert result == {"a": 1000}

    def test_no_new_hashes_is_a_noop(self):
        result = record_added_at({"a": 500}, ["a", "b"], ["a", "b"], 1000)
        assert result == {"a": 500}

    def test_readded_hash_gets_fresh_timestamp(self):
        # "a" was removed earlier (not in existing list) but a stale map entry
        # survived; re-adding must reset the date like Spotify does.
        result = record_added_at({"a": 500}, [], ["a"], 1000)
        assert result == {"a": 1000}

    def test_does_not_mutate_input_map(self):
        original = {"a": 500}
        record_added_at(original, ["a"], ["a", "b"], 1000)
        assert original == {"a": 500}

    def test_pre_feature_entries_stay_absent(self):
        # Hashes that were already in the playlist before the feature never
        # get a fabricated timestamp.
        result = record_added_at(None, ["old1", "old2"], ["old1", "old2", "new"], 1000)
        assert result == {"new": 1000}


class TestPruneAddedAt:
    def test_drops_removed_hashes(self):
        result = prune_added_at({"a": 1, "b": 2, "c": 3}, ["a", "c"])
        assert result == {"a": 1, "c": 3}

    def test_none_map_returns_empty(self):
        assert prune_added_at(None, ["a"]) == {}

    def test_empty_remaining_drops_everything(self):
        assert prune_added_at({"a": 1}, []) == {}

    def test_untracked_remaining_hashes_are_ignored(self):
        # Remaining hashes without a timestamp (pre-feature) stay absent.
        assert prune_added_at({"a": 1}, ["a", "old"]) == {"a": 1}

    def test_does_not_mutate_input_map(self):
        original = {"a": 1, "b": 2}
        prune_added_at(original, ["a"])
        assert original == {"a": 1, "b": 2}
