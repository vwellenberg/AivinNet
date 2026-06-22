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
    def test_noop_when_old_not_favorited(self):
        # Nothing favorited the old identity -> nothing to migrate.
        assert favorite_migration_action(None, None) == "noop"
        assert favorite_migration_action(None, 1) == "noop"

    def test_rename_when_new_not_favorited(self):
        # The old identity is favorited and the new one is free -> repoint it.
        assert favorite_migration_action(1, None) == "rename"

    def test_drop_when_same_user_already_favorited_new(self):
        # Same user favorited both identities -> the old row is redundant.
        assert favorite_migration_action(1, 1) == "drop"

    def test_keep_when_different_user_owns_new(self):
        # A DIFFERENT user already owns the new hash. The global UNIQUE(hash)
        # forbids a second row, so the old favorite must be KEPT, never deleted
        # (deleting it would silently destroy user 1's favorite).
        assert favorite_migration_action(1, 2) == "keep"
