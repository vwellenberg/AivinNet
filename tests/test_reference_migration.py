"""Tests for the trackhash reference-migration logic (pure, no database)."""

from swingmusic.lib.reference_migration import (
    favorite_migration_action,
    replace_trackhash_in_list,
)


class TestReplaceTrackhashInList:
    def test_old_not_present_returns_unchanged_copy(self):
        original = ["a", "b", "c"]
        result = replace_trackhash_in_list(original, "x", "y")
        assert result == ["a", "b", "c"]
        assert result is not original  # must be a copy

    def test_simple_replace_preserves_position(self):
        assert replace_trackhash_in_list(["a", "old", "c"], "old", "new") == ["a", "new", "c"]

    def test_replace_at_start(self):
        assert replace_trackhash_in_list(["old", "b", "c"], "old", "new") == ["new", "b", "c"]

    def test_replace_at_end(self):
        assert replace_trackhash_in_list(["a", "b", "old"], "old", "new") == ["a", "b", "new"]

    def test_new_after_old_collapses_to_old_position(self):
        # old at index 1, new at index 3 -> new takes index 1, later new dropped
        assert replace_trackhash_in_list(["a", "old", "b", "new", "c"], "old", "new") == ["a", "new", "b", "c"]

    def test_new_before_old_keeps_earlier_position(self):
        # new already at index 1, old at index 3 -> new stays at index 1, old dropped
        assert replace_trackhash_in_list(["a", "new", "b", "old", "c"], "old", "new") == ["a", "new", "b", "c"]

    def test_adjacent_old_then_new(self):
        assert replace_trackhash_in_list(["old", "new"], "old", "new") == ["new"]

    def test_adjacent_new_then_old(self):
        assert replace_trackhash_in_list(["new", "old"], "old", "new") == ["new"]

    def test_other_hashes_untouched(self):
        assert replace_trackhash_in_list(["z", "old", "z2"], "old", "new") == ["z", "new", "z2"]

    def test_empty_list(self):
        assert replace_trackhash_in_list([], "old", "new") == []

    def test_does_not_mutate_input(self):
        original = ["a", "old", "c"]
        replace_trackhash_in_list(original, "old", "new")
        assert original == ["a", "old", "c"]


class TestFavoriteMigrationAction:
    def test_drop_when_new_already_favorited(self):
        assert favorite_migration_action(True) == "drop"

    def test_rename_when_new_not_favorited(self):
        assert favorite_migration_action(False) == "rename"
