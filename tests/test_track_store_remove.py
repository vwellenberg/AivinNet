"""Regression tests for TrackStore.remove_tracks_by_filepaths.

Removing a track that empties its group used to delete a key from
``trackhashmap`` while iterating it, raising "dictionary changed size during
iteration" — which broke every track edit that reindexed a unique track.
"""

import sys
from unittest.mock import MagicMock

# Mock heavy / unavailable deps before importing swingmusic modules (the CI test
# job installs only a handful of packages).
for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "flask_jwt_extended",
    "flask",
    "swingmusic.db.libdata",
    "swingmusic.models",
    "swingmusic.utils.auth",
    "swingmusic.utils.remove_duplicates",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

from swingmusic.store.tracks import TrackGroup, TrackStore  # noqa: E402


class _Track:
    """Minimal stand-in for a Track (only the fields the method touches)."""

    def __init__(self, trackhash: str, filepath: str):
        self.trackhash = trackhash
        self.filepath = filepath


def _make_store(*specs):
    """specs: (trackhash, [filepaths]) -> populate TrackStore.trackhashmap."""
    TrackStore.trackhashmap = {trackhash: TrackGroup([_Track(trackhash, fp) for fp in fps]) for trackhash, fps in specs}


class TestRemoveTracksByFilepaths:
    def test_remove_only_track_empties_and_drops_group(self):
        _make_store(("h0", ["/a.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/a.mp3"})
        assert "h0" not in TrackStore.trackhashmap

    def test_remove_middle_of_many(self):
        _make_store(("h0", ["/0.mp3"]), ("h1", ["/1.mp3"]), ("h2", ["/2.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/1.mp3"})
        assert sorted(TrackStore.trackhashmap) == ["h0", "h2"]

    def test_remove_first_and_last(self):
        _make_store(("h0", ["/0.mp3"]), ("h1", ["/1.mp3"]), ("h2", ["/2.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/0.mp3", "/2.mp3"})
        assert sorted(TrackStore.trackhashmap) == ["h1"]

    def test_group_with_duplicate_survives(self):
        # two files share a trackhash; removing one keeps the group
        _make_store(("h0", ["/a.mp3", "/b.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/a.mp3"})
        assert "h0" in TrackStore.trackhashmap
        assert [t.filepath for t in TrackStore.trackhashmap["h0"].tracks] == ["/b.mp3"]

    def test_unknown_filepath_is_noop(self):
        _make_store(("h0", ["/a.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/nope.mp3"})
        assert sorted(TrackStore.trackhashmap) == ["h0"]

    def test_remove_all(self):
        _make_store(("h0", ["/0.mp3"]), ("h1", ["/1.mp3"]))
        TrackStore.remove_tracks_by_filepaths({"/0.mp3", "/1.mp3"})
        assert TrackStore.trackhashmap == {}

    def test_remove_by_single_filepath_helper(self):
        _make_store(("h0", ["/a.mp3"]), ("h1", ["/b.mp3"]))
        TrackStore.remove_track_by_filepath("/a.mp3")
        assert sorted(TrackStore.trackhashmap) == ["h1"]
