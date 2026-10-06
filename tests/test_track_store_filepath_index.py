"""TrackStore answers path lookups from an index that cannot go stale (#295).

Every ranged chunk of a stream, the silence probe and tag edits ask the store
for a track by PATH. That used to walk the whole store on the single request
thread. The index that replaces the walk is checked on every hit, so the many
places that mutate the store (indexer, renames, removals) need not know it.
"""

import sys
from unittest.mock import MagicMock

for _mod in [
    "sqlalchemy",
    "sqlalchemy.orm",
    "flask_jwt_extended",
    "flask",
    "aivinnet.db.libdata",
    "aivinnet.models",
    "aivinnet.utils.auth",
    "aivinnet.utils.remove_duplicates",
]:
    if _mod not in sys.modules:
        sys.modules[_mod] = MagicMock()

import pytest  # noqa: E402

from aivinnet.store.tracks import TrackStore  # noqa: E402


class _Track:
    def __init__(self, trackhash: str, filepath: str, folder: str = "/music"):
        self.trackhash = trackhash
        self.filepath = filepath
        self.folder = folder


class _CountingMap(dict):
    """Counts full passes over the store (`values()`)."""

    passes = 0

    def values(self):
        type(self).passes += 1
        return super().values()


@pytest.fixture(autouse=True)
def store():
    _CountingMap.passes = 0
    TrackStore.trackhashmap = _CountingMap()
    TrackStore._by_filepath = {}
    yield
    TrackStore.trackhashmap = {}
    TrackStore._by_filepath = {}


def _add(track):
    TrackStore.add_track(track)
    return track


def test_a_path_is_found_and_the_second_lookup_does_not_walk_the_store():
    track = _add(_Track("h1", "/music/a.mp3"))
    _add(_Track("h2", "/music/b.mp3"))

    assert TrackStore.get_tracks_by_filepaths(["/music/a.mp3"]) == [track]
    passes = _CountingMap.passes

    assert TrackStore.get_tracks_by_filepaths(["/music/a.mp3"]) == [track]
    assert _CountingMap.passes == passes, "the second lookup walked the store again"


def test_a_track_added_after_the_index_was_built_is_found():
    _add(_Track("h1", "/music/a.mp3"))
    TrackStore.get_tracks_by_filepaths(["/music/a.mp3"])

    late = _add(_Track("h2", "/music/late.mp3"))

    assert TrackStore.get_tracks_by_filepaths(["/music/late.mp3"]) == [late]


def test_a_removed_track_is_not_returned_from_the_index():
    _add(_Track("h1", "/music/a.mp3"))
    TrackStore.get_tracks_by_filepaths(["/music/a.mp3"])

    TrackStore.remove_tracks_by_filepaths({"/music/a.mp3"})

    assert TrackStore.get_tracks_by_filepaths(["/music/a.mp3"]) == []


def test_a_track_renamed_in_place_answers_to_its_new_path_only():
    track = _add(_Track("h1", "/music/old.mp3"))
    TrackStore.get_tracks_by_filepaths(["/music/old.mp3"])

    track.filepath = "/music/new.mp3"  # what a rename does to the stored object

    assert TrackStore.get_tracks_by_filepaths(["/music/old.mp3"]) == []
    assert TrackStore.get_tracks_by_filepaths(["/music/new.mp3"]) == [track]


def test_a_track_replaced_under_the_same_path_is_the_new_one():
    # A tag edit drops the old object and stores a new one for the same file.
    _add(_Track("h1", "/music/a.mp3"))
    TrackStore.get_tracks_by_filepaths(["/music/a.mp3"])

    TrackStore.remove_tracks_by_filepaths({"/music/a.mp3"})
    new = _add(_Track("h9", "/music/a.mp3"))

    assert TrackStore.get_tracks_by_filepaths(["/music/a.mp3"]) == [new]


def test_an_unknown_path_finds_nothing():
    _add(_Track("h1", "/music/a.mp3"))

    assert TrackStore.get_tracks_by_filepaths(["/elsewhere/x.mp3"]) == []


def test_several_paths_at_once():
    a = _add(_Track("h1", "/music/a.mp3"))
    b = _add(_Track("h2", "/music/b.mp3"))

    found = TrackStore.get_tracks_by_filepaths(["/music/a.mp3", "/music/b.mp3", "/nope.mp3"])

    assert sorted(found, key=lambda t: t.filepath) == [a, b]


def test_a_folder_does_not_take_its_longer_named_sibling_along():
    rock = _add(_Track("h1", "/music/Rock/a.mp3", folder="/music/Rock"))
    deeper = _add(_Track("h2", "/music/Rock/Live/b.mp3", folder="/music/Rock/Live"))
    _add(_Track("h3", "/music/Rock and Roll/c.mp3", folder="/music/Rock and Roll"))

    found = TrackStore.get_tracks_in_path("/music/Rock")

    assert sorted(found, key=lambda t: t.filepath) == [deeper, rock]
