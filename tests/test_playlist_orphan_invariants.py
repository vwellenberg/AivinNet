"""
Orphan-safety invariants for EVERY playlist trackhash mutation.

An "orphan" is a stored trackhash that no longer resolves to a track in the
library. The API's read path only returns resolvable tracks, so a client can
neither see orphans nor index around them — which is how two data-loss bugs
happened (vwellenberg/AivinNet#51):

  * `/reorder` replaced the stored list with the client's partial one
    (120 tracks -> 44 after a single drag),
  * `remove-tracks` matched a resolved-list index against a stored-list index and
    silently removed nothing.

These tests are deliberately written as ONE parametrised invariant over the whole
family of mutation helpers rather than as per-function cases. A helper added later
gets registered in MUTATIONS and inherits the guarantee; forgetting to register it
is the only way to slip through, and the roster test below makes that visible too.

`prune_orphan_trackhashes` is the single intentional exception: dropping orphans
is its entire job.
"""

import inspect

import pytest

from aivinnet.lib import playlist_maintenance as pm
from aivinnet.lib.playlist_maintenance import (
    merge_trackhashes,
    move_trackhash,
    prune_orphan_trackhashes,
    remove_trackhashes,
    trackhash_diff,
)
from aivinnet.lib.reference_migration import (
    migrate_added_at,
    playlist_migration_values,
    replace_trackhash_in_list,
)

# A stored list as the DB holds it: resolvable tracks with an unresolvable hash
# wedged between them, so stored indices and resolved indices disagree.
ORPHAN = "0rphan00000000ff"
STORED = ["a", ORPHAN, "b", "c", "d"]
RESOLVABLE = {"a", "b", "c", "d"}

#: name -> callable(stored_list) -> new_list.
#: Every helper that rewrites a playlist's trackhash list belongs here.
MUTATIONS = {
    "append (POST /<id>/add)": lambda s: merge_trackhashes(s, ["e"]),
    "append existing (dedupe)": lambda s: merge_trackhashes(s, ["b"]),
    "move down (PUT /<id>/move-track)": lambda s: move_trackhash(s, "a", "c"),
    "move up": lambda s: move_trackhash(s, "d", "b"),
    "move to end": lambda s: move_trackhash(s, "a", None),
    "remove one (POST /<id>/remove-tracks)": lambda s: remove_trackhashes(s, [{"trackhash": "b", "index": 1}]),
    "remove several": lambda s: remove_trackhashes(s, [{"trackhash": "b", "index": 1}, {"trackhash": "d", "index": 3}]),
    "track edit rewrite (repoint_track_references)": lambda s: replace_trackhash_in_list(s, "b", "b-new"),
}


@pytest.mark.parametrize("name", sorted(MUTATIONS))
class TestOrphansSurviveEveryMutation:
    def test_orphan_hash_is_still_stored(self, name):
        result = MUTATIONS[name](STORED)
        assert ORPHAN in result, f"{name} dropped the orphan hash"

    def test_orphan_keeps_its_relative_place(self, name):
        # It must not be shuffled to the end as a side effect of the rewrite.
        result = MUTATIONS[name](STORED)
        assert result.index(ORPHAN) <= 2, f"{name} displaced the orphan to {result.index(ORPHAN)}"

    def test_no_resolvable_track_is_lost_beyond_the_intent(self, name):
        # Removals drop exactly what they were asked to; nothing else vanishes.
        result = MUTATIONS[name](STORED)
        removed = RESOLVABLE - set(result)
        if name.startswith("remove"):
            assert removed and removed <= {"b", "d"}
        elif "track edit" in name:
            assert removed == {"b"}  # renamed, and the new identity is present
            assert "b-new" in result
        else:
            assert removed == set(), f"{name} lost {removed}"

    def test_input_is_not_mutated(self, name):
        stored = list(STORED)
        MUTATIONS[name](stored)
        assert stored == STORED, f"{name} mutated its input list in place"

    def test_no_duplicates_are_introduced(self, name):
        result = MUTATIONS[name](STORED)
        assert len(result) == len(set(result)), f"{name} introduced a duplicate"


class TestMutationRosterIsComplete:
    """
    Guards the roster above against a helper being added without a registration.

    Not a strict count assertion — that would break on every unrelated helper —
    but the public mutation surface of playlist_maintenance is small and known, so
    an unexpected list-returning helper should be looked at (and either registered
    in MUTATIONS or listed here as read-only/intentional).
    """

    KNOWN = {
        "merge_trackhashes",  # append
        "move_trackhash",  # move-track
        "remove_trackhashes",  # remove-tracks
        "prune_orphan_trackhashes",  # intentionally drops orphans
        "record_added_at",  # added_at map, not the trackhash list
        "prune_added_at",  # added_at map, not the trackhash list
        "trackhash_diff",  # read-only comparison
    }

    def test_no_unregistered_mutation_helper(self):
        # Functions only: the module's exception class is callable but is not a
        # mutation helper.
        public = {
            name
            for name, obj in vars(pm).items()
            if not name.startswith("_") and inspect.isfunction(obj) and obj.__module__ == pm.__name__
        }
        assert public <= self.KNOWN, (
            f"New helper(s) {public - self.KNOWN} in playlist_maintenance. If it rewrites a "
            "playlist's trackhash list, register it in MUTATIONS so it inherits the orphan "
            "invariants; otherwise add it to KNOWN with a note."
        )


class TestPruneOrphansIsTheOnlyIntentionalDrop:
    def test_drops_exactly_the_orphans(self):
        assert prune_orphan_trackhashes(STORED, RESOLVABLE) == ["a", "b", "c", "d"]

    def test_preserves_the_order_of_survivors(self):
        stored = ["c", ORPHAN, "a", "b"]
        assert prune_orphan_trackhashes(stored, RESOLVABLE) == ["c", "a", "b"]

    def test_is_a_noop_without_orphans(self):
        assert prune_orphan_trackhashes(["a", "b"], RESOLVABLE) == ["a", "b"]


class TestReorderGuardSeesOrphans:
    """
    The client can only ever submit resolvable hashes, so its "full list" is
    lossy by exactly the orphans. The guard has to catch that, not wave it through.
    """

    def test_a_client_shaped_full_list_is_rejected(self):
        resolved_only = ["d", "c", "b", "a"]  # every resolvable hash, reordered
        dropped, added = trackhash_diff(resolved_only, STORED)
        assert dropped == [ORPHAN]
        assert added == []

    def test_a_true_permutation_of_the_stored_list_passes(self):
        assert trackhash_diff(["d", "c", ORPHAN, "b", "a"], STORED) == ([], [])


class TestAddedAtFollowsTrackhashRewrites:
    """
    `added_at` is a parallel map keyed by trackhash. A tag edit changes the hash,
    so the map has to be rewritten with the list or the track shows "—" as its
    date added and a stale key lingers forever.
    """

    def test_the_date_moves_to_the_new_hash(self):
        assert migrate_added_at({"b": 1000, "a": 500}, "b", "b-new") == {"b-new": 1000, "a": 500}

    def test_the_old_key_is_dropped(self):
        assert "b" not in migrate_added_at({"b": 1000}, "b", "b-new")

    def test_editing_a_tag_does_not_reset_the_date(self):
        migrated = migrate_added_at({"b": 1000}, "b", "b-new")
        assert migrated["b-new"] == 1000

    def test_collapsing_onto_an_existing_entry_keeps_the_earlier_date(self):
        # The playlist already held the new identity; the list collapses to one
        # entry, so the date must be when the track FIRST entered the playlist.
        assert migrate_added_at({"b": 1000, "b-new": 2000}, "b", "b-new") == {"b-new": 1000}

    def test_unknown_old_hash_is_a_noop(self):
        assert migrate_added_at({"a": 500}, "zzz", "yyy") == {"a": 500}

    def test_none_map_is_treated_as_empty(self):
        assert migrate_added_at(None, "b", "b-new") == {}

    def test_does_not_mutate_the_input_map(self):
        original = {"b": 1000}
        migrate_added_at(original, "b", "b-new")
        assert original == {"b": 1000}

    def test_orphan_entries_in_the_map_are_left_alone(self):
        # Only the edited identity is touched; an orphan's date stays put.
        migrated = migrate_added_at({ORPHAN: 100, "b": 1000}, "b", "b-new")
        assert migrated[ORPHAN] == 100


class TestPlaylistMigrationValues:
    """
    The per-playlist decision inside `migrate_track_references`. This is where the
    bug actually lived — the list was rewritten and the parallel `added_at` map was
    forgotten — so it is asserted at the level that writes BOTH columns, not just
    at the level of each helper.
    """

    def test_rewrites_the_list_and_the_added_at_map_together(self):
        values = playlist_migration_values(STORED, {"added_at": {"b": 1000}}, "b", "b-new")
        assert values["trackhashes"] == ["a", ORPHAN, "b-new", "c", "d"]
        assert values["extra"]["added_at"] == {"b-new": 1000}

    def test_unaffected_playlist_returns_none(self):
        assert playlist_migration_values(STORED, {"added_at": {"b": 1}}, "not-here", "new") is None

    def test_empty_playlist_returns_none(self):
        assert playlist_migration_values([], {}, "b", "b-new") is None
        assert playlist_migration_values(None, None, "b", "b-new") is None

    def test_extra_is_omitted_when_nothing_in_it_changed(self):
        # A playlist from before the added_at feature: rewrite the list only, and
        # do not fabricate an extra payload.
        values = playlist_migration_values(STORED, None, "b", "b-new")
        assert "extra" not in values
        assert values["trackhashes"] == ["a", ORPHAN, "b-new", "c", "d"]

    def test_other_extra_keys_survive_the_migration(self):
        values = playlist_migration_values(STORED, {"added_at": {"b": 1000}, "keepme": 7}, "b", "b-new")
        assert values["extra"]["keepme"] == 7

    def test_the_orphan_survives_a_tag_edit(self):
        values = playlist_migration_values(STORED, {"added_at": {ORPHAN: 5, "b": 1000}}, "b", "b-new")
        assert ORPHAN in values["trackhashes"]
        assert values["extra"]["added_at"][ORPHAN] == 5

    def test_does_not_mutate_the_input_extra(self):
        extra = {"added_at": {"b": 1000}}
        playlist_migration_values(STORED, extra, "b", "b-new")
        assert extra == {"added_at": {"b": 1000}}
