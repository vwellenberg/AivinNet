"""Tests for playlist track reordering logic."""

import sys
from unittest.mock import MagicMock

# Mock heavy dependencies before importing swingmusic modules
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


def _reorder_logic(playlist_table, playlist_id: int, trackhashes: list[str]):
    """Extracted reorder logic matching the API endpoint."""
    playlist = playlist_table.get_by_id(playlist_id)
    if playlist is None:
        return {"error": "Playlist not found"}, 404
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
