"""Regression: saving a folder as a playlist must keep the visible order.

The folder view lists files by modification time (folderslib), while
TrackStore.get_tracks_in_path returns tracks in arbitrary map order and
sort_tracks("default") is a no-op — the created playlist scrambled the
order the user saw (folder track 1 became playlist track 17).
"""

from types import SimpleNamespace


def _track(trackhash: str, last_mod: int, title: str = ""):
    return SimpleNamespace(trackhash=trackhash, last_mod=last_mod, title=title or trackhash)


def test_default_sort_follows_folder_view_mtime_order(monkeypatch):
    from swingmusic.api import playlist as playlist_api

    # Store order deliberately scrambled vs. mtime order.
    store_tracks = [
        _track("newest", last_mod=300),
        _track("oldest", last_mod=100),
        _track("middle", last_mod=200),
    ]
    monkeypatch.setattr(
        playlist_api.TrackStore,
        "get_tracks_in_path",
        classmethod(lambda cls, path: list(store_tracks)),
    )

    hashes = playlist_api.get_path_trackhashes("/music/folder", "default", False)

    assert hashes == ["oldest", "middle", "newest"]


def test_explicit_sort_key_still_applies(monkeypatch):
    from swingmusic.api import playlist as playlist_api

    store_tracks = [
        _track("b", last_mod=1, title="Bravo"),
        _track("a", last_mod=2, title="Alpha"),
    ]
    monkeypatch.setattr(
        playlist_api.TrackStore,
        "get_tracks_in_path",
        classmethod(lambda cls, path: list(store_tracks)),
    )

    hashes = playlist_api.get_path_trackhashes("/music/folder", "title", False)

    assert hashes == ["a", "b"]
