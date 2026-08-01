"""Tests for playlist track reordering logic."""

import sys
from unittest.mock import MagicMock

# Mock heavy dependencies before importing swingmusic modules
_installed: list[str] = []
for mod_name in [
    "flask_jwt_extended",
    "flask",
    "flask_cors",
    "flask_compress",
    "flask_openapi3",
    "PIL",
    "colorgram",
    "tqdm",
    "tinytag",
    "psutil",
    "show_in_file_manager",
    "tabulate",
    "setproctitle",
    "watchdog",
    "sqlalchemy",
    "sortedcontainers",
    "ffmpeg",
    "schedule",
    "pystray",
    "rapidfuzz",
]:
    if mod_name not in sys.modules:
        sys.modules[mod_name] = MagicMock()
        _installed.append(mod_name)


from swingmusic.lib.playlist_maintenance import trackhash_diff  # noqa: E402

# Drop the temporary mocks again — pytest imports every test module at
# collection, so one left behind is inherited by every module collected later.
for _mod in _installed:
    sys.modules.pop(_mod, None)


def _reorder_logic(playlist_table, playlist_id: int, trackhashes: list[str]):
    """Extracted reorder logic matching the API endpoint."""
    playlist = playlist_table.get_by_id(playlist_id)
    if playlist is None:
        return {"error": "Playlist not found"}, 404

    dropped, added = trackhash_diff(trackhashes, playlist.trackhashes)
    if dropped or added:
        return {"error": "not a permutation", "dropped": dropped, "added": added}, 409

    playlist_table.update_one(playlist_id, {"trackhashes": trackhashes})
    return {"msg": "Done"}, 200


class TestReorderEndpointLogic:
    """Tests for the reorder endpoint logic (extracted for testability)."""

    def _make_table(self, playlist=None):
        table = MagicMock()
        table.get_by_id.return_value = playlist
        return table

    def _make_playlist(self, trackhashes: list[str]):
        p = MagicMock()
        p.trackhashes = trackhashes
        return p

    def test_returns_404_when_playlist_not_found(self):
        table = self._make_table(playlist=None)
        result, status = _reorder_logic(table, 999, ["a", "b"])
        assert status == 404
        assert "error" in result

    def test_returns_200_on_success(self):
        table = self._make_table(playlist=self._make_playlist(["a", "b", "c"]))
        _, status = _reorder_logic(table, 1, ["c", "a", "b"])
        assert status == 200

    # --- data-loss regression ---------------------------------------------
    # A paginated client submitted only the tracks it had loaded; the endpoint
    # replaced the stored list with them and deleted the rest (120 -> 44 tracks
    # measured on a live server). A partial submit must now be refused.

    def test_truncated_submission_is_refused(self):
        stored = [f"h{i}" for i in range(120)]
        table = self._make_table(playlist=self._make_playlist(stored))
        result, status = _reorder_logic(table, 1, stored[:38])
        assert status == 409
        assert len(result["dropped"]) == 82

    def test_truncated_submission_does_not_write(self):
        stored = [f"h{i}" for i in range(120)]
        table = self._make_table(playlist=self._make_playlist(stored))
        _reorder_logic(table, 1, stored[:38])
        table.update_one.assert_not_called()

    def test_submission_missing_only_an_orphan_hash_is_refused(self):
        # The client cannot see orphan hashes at all, so a full-list submit from
        # it is still lossy by exactly those entries.
        stored = ["orphan", "a", "b", "c"]
        table = self._make_table(playlist=self._make_playlist(stored))
        result, status = _reorder_logic(table, 1, ["c", "b", "a"])
        assert status == 409
        assert result["dropped"] == ["orphan"]

    def test_submission_with_a_foreign_hash_is_refused(self):
        table = self._make_table(playlist=self._make_playlist(["a", "b"]))
        result, status = _reorder_logic(table, 1, ["a", "b", "smuggled"])
        assert status == 409
        assert result["added"] == ["smuggled"]

    def test_calls_update_with_new_order(self):
        table = self._make_table(playlist=self._make_playlist(["a", "b", "c"]))
        new_order = ["c", "a", "b"]
        _reorder_logic(table, 1, new_order)
        table.update_one.assert_called_once_with(1, {"trackhashes": new_order})

    def test_persists_exact_new_order(self):
        table = self._make_table(playlist=self._make_playlist(["h1", "h2", "h3", "h4"]))
        new_order = ["h4", "h1", "h3", "h2"]
        _reorder_logic(table, 1, new_order)
        called_with = table.update_one.call_args[0][1]["trackhashes"]
        assert called_with == new_order


class TestMoveTrackLogic:
    """Tests for the moveTrack array manipulation logic (mirrors frontend store logic)."""

    @staticmethod
    def move_track(tracks: list, from_idx: int, to_idx: int) -> list:
        """Python equivalent of the TypeScript moveTrack store action."""
        result = tracks[:]
        item = result.pop(from_idx)
        adjusted = to_idx - 1 if to_idx > from_idx else to_idx
        result.insert(adjusted, item)
        return result

    def test_move_forward(self):
        tracks = ["a", "b", "c", "d", "e"]
        result = self.move_track(tracks, 0, 3)
        assert result == ["b", "c", "a", "d", "e"]

    def test_move_backward(self):
        tracks = ["a", "b", "c", "d", "e"]
        result = self.move_track(tracks, 3, 1)
        assert result == ["a", "d", "b", "c", "e"]

    def test_move_to_end(self):
        tracks = ["a", "b", "c"]
        result = self.move_track(tracks, 0, 3)
        assert result == ["b", "c", "a"]

    def test_move_to_beginning(self):
        tracks = ["a", "b", "c"]
        result = self.move_track(tracks, 2, 0)
        assert result == ["c", "a", "b"]

    def test_move_adjacent_forward_is_noop(self):
        tracks = ["a", "b", "c"]
        # dropping on bottom half of same item or top half of next → no move
        result = self.move_track(tracks, 1, 2)
        assert result == ["a", "b", "c"]

    def test_original_unchanged(self):
        tracks = ["a", "b", "c"]
        self.move_track(tracks, 0, 2)
        assert tracks == ["a", "b", "c"]
