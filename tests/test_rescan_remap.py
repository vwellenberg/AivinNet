"""
A scan that changed a track's hash carries its references, by path (#433).

The bug: a tag changed outside the app kept the file's path and got a new hash
on the next scan. Favourites, scrobbles and playlists kept the old hash, and
nothing moved them. `remap_by_path` is the part that decides what moves.
"""

from types import SimpleNamespace

from aivinnet.lib.rescan_remap import hashes_by_path, remap_by_path


class TestRemapByPath:
    def test_a_file_that_got_a_new_hash_moves_its_references(self):
        before = {"/m/a.mp3": "old1"}
        after = {"/m/a.mp3": "new1"}

        assert remap_by_path(before, after) == {"old1": "new1"}

    def test_an_unchanged_file_moves_nothing(self):
        assert remap_by_path({"/m/a.mp3": "h1"}, {"/m/a.mp3": "h1"}) == {}

    def test_a_hash_another_unchanged_file_still_holds_is_kept(self):
        # Two files shared "shared"; one changed. The other still names "shared",
        # so its favourite and plays are still right and must not move.
        before = {"/m/a.mp3": "shared", "/m/b.mp3": "shared"}
        after = {"/m/a.mp3": "new_a", "/m/b.mp3": "shared"}

        assert remap_by_path(before, after) == {}

    def test_a_hash_spread_over_two_new_hashes_is_ambiguous_and_left_out(self):
        # One reference cannot follow two different tracks.
        before = {"/m/a.mp3": "shared", "/m/b.mp3": "shared"}
        after = {"/m/a.mp3": "new_a", "/m/b.mp3": "new_b"}

        assert remap_by_path(before, after) == {}

    def test_a_deleted_file_is_not_remapped(self):
        assert remap_by_path({"/m/a.mp3": "h1"}, {}) == {}

    def test_a_new_file_has_no_old_hash_to_move(self):
        assert remap_by_path({}, {"/m/new.mp3": "h9"}) == {}

    def test_several_files_map_independently(self):
        before = {"/m/a.mp3": "a0", "/m/b.mp3": "b0", "/m/c.mp3": "c0"}
        after = {"/m/a.mp3": "a1", "/m/b.mp3": "b1", "/m/c.mp3": "c0"}

        assert remap_by_path(before, after) == {"a0": "a1", "b0": "b1"}


class TestHashesByPath:
    def test_maps_every_file_to_the_hash_its_track_carries(self):
        group = SimpleNamespace(
            tracks=[
                SimpleNamespace(filepath="/m/a.mp3", trackhash="h1"),
                SimpleNamespace(filepath="/m/a.flac", trackhash="h1"),
            ]
        )
        other = SimpleNamespace(tracks=[SimpleNamespace(filepath="/m/b.mp3", trackhash="h2")])

        assert hashes_by_path({"h1": group, "h2": other}) == {
            "/m/a.mp3": "h1",
            "/m/a.flac": "h1",
            "/m/b.mp3": "h2",
        }

    def test_an_empty_library_maps_nothing(self):
        assert hashes_by_path({}) == {}
