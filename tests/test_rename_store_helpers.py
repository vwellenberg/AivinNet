"""FolderStore follows a file when its path or its hash changes (#144).

FolderStore is what the folder view reads, as path -> trackhash. It
used to be told about nothing after startup — so after a tag edit (which
changes the hash) the folder of a repaired album listed 0 of its 94 files until
the next full rescan. Measured live on "The Guild 2" on 2026-09-23.
"""

import sys
from unittest.mock import MagicMock, patch

for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "flask_jwt_extended",
    "flask",
    "sortedcontainers",
    "aivinnet.db.libdata",
    "aivinnet.models",
    "aivinnet.utils.auth",
    "aivinnet.utils.remove_duplicates",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from aivinnet.store.folder import FolderStore  # noqa: E402
from aivinnet.store.tracks import TrackGroup, TrackStore  # noqa: E402


class _Track:
    def __init__(self, trackhash: str, filepath: str):
        self.trackhash = trackhash
        self.filepath = filepath


class TestFolderStore:
    def setup_method(self):
        # The real class holds a SortedSet; the fast lane has no
        # sortedcontainers, and only membership matters here.
        FolderStore.filepaths = set()
        FolderStore.map = {}

    def test_a_new_hash_replaces_the_stale_one(self):
        FolderStore.index_file("/m/a.mp3", "old")
        FolderStore.index_file("/m/a.mp3", "new")
        assert FolderStore.map == {"/m/a.mp3": "new"}
        assert FolderStore.filepaths == {"/m/a.mp3"}

    def test_a_rename_leaves_nothing_behind_under_the_old_path(self):
        FolderStore.index_file("/m/a.mp3", "h")
        FolderStore.move_filepath("/m/a.mp3", "/m/01 - A.mp3", "h")
        assert FolderStore.map == {"/m/01 - A.mp3": "h"}
        assert FolderStore.filepaths == {"/m/01 - A.mp3"}

    def test_the_view_finds_the_file_under_its_new_hash(self):
        track = _Track("new", "/m/a.mp3")
        TrackStore.trackhashmap = {"new": TrackGroup([track])}
        FolderStore.index_file("/m/a.mp3", "old")

        # The bug: the map still says "old", so the view finds nothing.
        assert list(FolderStore.get_tracks_by_filepaths(["/m/a.mp3"])) == []

        FolderStore.index_file("/m/a.mp3", "new")
        assert list(FolderStore.get_tracks_by_filepaths(["/m/a.mp3"])) == [track]


def test_a_tag_edit_tells_the_folder_view_the_new_hash(monkeypatch):
    """`track_edit._index_file` is where a tag edit re-enters the stores."""
    mocks = {
        name: MagicMock()
        for name in [
            "aivinnet.config",
            "aivinnet.db",
            "aivinnet.db.libdata",
            "aivinnet.db.utils",
            "aivinnet.lib.tagger",
            "aivinnet.lib.taglib",
            "aivinnet.models",
            "aivinnet.store",
            "aivinnet.store.albums",
            "aivinnet.store.artists",
            "aivinnet.store.folder",
            "aivinnet.store.tracks",
        ]
    }
    with patch.dict(sys.modules, mocks):
        from aivinnet.lib import track_edit

    monkeypatch.setattr(track_edit, "UserConfig", MagicMock())
    monkeypatch.setattr(track_edit, "get_tags", lambda *_: {"bitrate": 320, "duration": 200, "albumhash": "a"})
    monkeypatch.setattr(track_edit, "extract_thumb", MagicMock())
    monkeypatch.setattr(track_edit, "TrackTable", MagicMock())
    monkeypatch.setattr(track_edit, "TrackStore", MagicMock())
    monkeypatch.setattr(track_edit, "track_to_dataclass", lambda *_: _Track("fresh-hash", "/m/a.mp3"))
    folder = MagicMock()
    monkeypatch.setattr(track_edit, "FolderStore", folder)

    track_edit._index_file("/m/a.mp3")

    folder.index_file.assert_called_once_with("/m/a.mp3", "fresh-hash")
